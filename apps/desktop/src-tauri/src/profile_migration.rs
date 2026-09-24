use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const SNAPSHOT_FILE: &str = "profile-migration.snapshot.json";
const COMPLETE_FILE: &str = "migration-complete.json";
const STATE_FILE: &str = "migration-state.json";
const MARKER_FILE: &str = "electron-profile-backup-v1.json";
const MAX_BATCH: usize = 128;
const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;
const MAX_RECORD_BYTES: usize = 4 * 1024 * 1024;
const MAX_MIGRATION_BYTES: usize = 512 * 1024 * 1024;
pub const DEFAULT_SOURCE_ORIGIN: &str = "file://";
pub const DEFAULT_TARGET_ORIGIN: &str = "https://tauri.localhost";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalStorageRecord {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IndexedDbRecord {
    pub key: Value,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDbStore {
    pub database: String,
    pub store: String,
    pub records: Vec<IndexedDbRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMigrationSnapshot {
    pub version: u32,
    pub migration_id: String,
    pub source_origin: String,
    pub target_origin: String,
    pub local_storage: Vec<LocalStorageRecord>,
    pub indexed_db: Vec<IndexedDbStore>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMigrationStatus {
    pub state: String,
    pub migration_id: Option<String>,
    pub source_origin: Option<String>,
    pub target_origin: Option<String>,
    pub local_storage_count: usize,
    pub indexed_db: Vec<IndexedDbStoreStatus>,
    pub message: Option<String>,
    pub owner_token: Option<String>,
    pub generation: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDbStoreStatus {
    pub database: String,
    pub store: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Batch<T> {
    pub records: Vec<T>,
    pub next_cursor: Option<usize>,
}

#[derive(Debug, Clone)]
struct MigrationState {
    snapshot: Option<ProfileMigrationSnapshot>,
    complete: bool,
    source_active: bool,
    exporting: bool,
    export_error: Option<String>,
    owner: Option<MigrationOwner>,
    next_generation: u64,
}

#[derive(Debug, Clone)]
struct MigrationOwner {
    window_label: String,
    token: String,
    generation: u64,
}

#[derive(Clone)]
pub struct ProfileMigration {
    migration_dir: PathBuf,
    source_origin: String,
    target_origin: String,
    state: Arc<Mutex<MigrationState>>,
}

impl ProfileMigration {
    pub fn new(user_data_path: impl Into<PathBuf>) -> Result<Self, String> {
        Self::new_with_origins(user_data_path, DEFAULT_SOURCE_ORIGIN, DEFAULT_TARGET_ORIGIN)
    }

    pub fn new_for_runtime(
        user_data_path: impl Into<PathBuf>,
        dev_port: Option<u16>,
    ) -> Result<Self, String> {
        match dev_port {
            Some(port) => Self::new_with_origins(
                user_data_path,
                format!("http://localhost:{port}"),
                format!("http://127.0.0.1:{port}"),
            ),
            None => Self::new(user_data_path),
        }
    }

    pub fn new_with_target_origin(
        user_data_path: impl Into<PathBuf>,
        target_origin: impl Into<String>,
    ) -> Result<Self, String> {
        Self::new_with_origins(user_data_path, DEFAULT_SOURCE_ORIGIN, target_origin)
    }

    pub fn new_with_origins(
        user_data_path: impl Into<PathBuf>,
        source_origin: impl Into<String>,
        target_origin: impl Into<String>,
    ) -> Result<Self, String> {
        let migration_dir = user_data_path.into().join("migration");
        let source_origin = source_origin.into();
        let target_origin = target_origin.into();
        validate_origin(&source_origin)?;
        validate_origin(&target_origin)?;
        let snapshot = read_snapshot(&migration_dir.join(SNAPSHOT_FILE))?;
        if let Some(snapshot) = snapshot.as_ref() {
            validate_origins(snapshot, &source_origin, &target_origin)?;
        }
        let complete = read_complete(
            &migration_dir.join(COMPLETE_FILE),
            snapshot.as_ref(),
            &source_origin,
            &target_origin,
        )?;
        Ok(Self {
            migration_dir,
            source_origin,
            target_origin,
            state: Arc::new(Mutex::new(MigrationState {
                snapshot,
                complete,
                source_active: false,
                exporting: false,
                export_error: None,
                owner: None,
                next_generation: 0,
            })),
        })
    }

    pub fn source_origin(&self) -> &str {
        &self.source_origin
    }

    pub fn target_origin(&self) -> &str {
        &self.target_origin
    }

    pub fn ingest_export(&self, export: Value) -> Result<ProfileMigrationStatus, String> {
        let snapshot = normalize_export(export)?;
        validate_origins(&snapshot, &self.source_origin, &self.target_origin)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if state.complete {
            return Ok(status_for(&state, true, None));
        }
        if state.source_active {
            return Err("profile migration cannot ingest while the legacy source is active".into());
        }
        let encoded = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
        atomic_write(&self.migration_dir.join(SNAPSHOT_FILE), &encoded)?;
        state.snapshot = Some(snapshot);
        state.complete = false;
        state.exporting = false;
        state.owner = None;
        state.next_generation = state.next_generation.saturating_add(1);
        state.export_error = None;
        Ok(status_for(&state, false, None))
    }

    pub fn begin_export(&self, metadata: Value) -> Result<ProfileMigrationStatus, String> {
        let object = metadata
            .as_object()
            .ok_or_else(|| "profile migration begin payload must be an object".to_string())?;
        let migration_id = required_string(object, "migrationId")?;
        let source_origin = required_string(object, "sourceOrigin")?;
        let target_origin = required_string(object, "targetOrigin")?;
        if source_origin != self.source_origin || target_origin != self.target_origin {
            return Err("profile migration begin origin does not match app".into());
        }
        let snapshot = ProfileMigrationSnapshot {
            version: 1,
            migration_id,
            source_origin,
            target_origin,
            local_storage: Vec::new(),
            indexed_db: vec![IndexedDbStore {
                database: "keyval-store".into(),
                store: "keyval".into(),
                records: Vec::new(),
            }],
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if state.complete {
            return Ok(status_for(&state, true, None));
        }
        state.snapshot = Some(snapshot);
        state.complete = false;
        state.exporting = true;
        state.owner = None;
        state.export_error = None;
        Ok(status_for(&state, false, None))
    }

    pub fn begin_export_from_chunk(
        &self,
        payload: Value,
    ) -> Result<ProfileMigrationStatus, String> {
        let object = payload
            .as_object()
            .ok_or_else(|| "profile migration chunk must be an object".to_string())?;
        if object.get("kind").and_then(Value::as_str) != Some("begin") {
            return Err("first profile migration chunk must be begin".into());
        }
        let metadata = object
            .get("metadata")
            .cloned()
            .ok_or_else(|| "profile migration begin chunk is missing metadata".to_string())?;
        self.begin_export(metadata)
    }

    pub fn append_export_chunk(
        &self,
        migration_id: &str,
        kind: &str,
        records: Vec<Value>,
    ) -> Result<(), String> {
        if records.len() > MAX_BATCH {
            return Err("profile migration exporter chunk exceeds record limit".into());
        }
        let batch_bytes = serde_json::to_vec(&records)
            .map_err(|error| error.to_string())?
            .len();
        if batch_bytes > MAX_BATCH_BYTES {
            return Err("profile migration exporter chunk exceeds byte limit".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if !state.exporting {
            return Err("profile migration export is not in progress".into());
        }
        let snapshot = state
            .snapshot
            .as_mut()
            .ok_or_else(|| "profile migration export has no initialized snapshot".to_string())?;
        if snapshot.migration_id != migration_id {
            return Err("profile migration id does not match export".into());
        }
        let mut added_bytes = 0usize;
        match kind {
            "localStorage" => {
                for record in records {
                    let object = record.as_object().ok_or_else(|| {
                        "localStorage export record must be an object".to_string()
                    })?;
                    let key = required_string(object, "key")?;
                    let value = required_string(object, "value")?;
                    ensure_record_size(&key, &value)?;
                    if allowed_local_storage_key(&key) {
                        added_bytes = added_bytes.saturating_add(key.len() + value.len());
                        if let Some(existing) = snapshot
                            .local_storage
                            .iter_mut()
                            .find(|existing| existing.key == key)
                        {
                            existing.value = value;
                        } else {
                            snapshot
                                .local_storage
                                .push(LocalStorageRecord { key, value });
                        }
                    }
                }
            }
            "indexedDb" => {
                let store = snapshot
                    .indexed_db
                    .iter_mut()
                    .find(|store| store.database == "keyval-store" && store.store == "keyval")
                    .expect("begin_export creates the allowlisted store");
                for record in records {
                    let object = record
                        .as_object()
                        .ok_or_else(|| "IndexedDB export record must be an object".to_string())?;
                    let key = object
                        .get("key")
                        .cloned()
                        .ok_or_else(|| "IndexedDB export record is missing key".to_string())?;
                    let value = object
                        .get("value")
                        .cloned()
                        .ok_or_else(|| "IndexedDB export record is missing value".to_string())?;
                    let key_bytes = serde_json::to_vec(&key).map_err(|error| error.to_string())?;
                    let value_bytes =
                        serde_json::to_vec(&value).map_err(|error| error.to_string())?;
                    ensure_record_size(
                        std::str::from_utf8(&key_bytes).unwrap_or_default(),
                        std::str::from_utf8(&value_bytes).unwrap_or_default(),
                    )?;
                    added_bytes = added_bytes.saturating_add(key_bytes.len() + value_bytes.len());
                    if let Some(existing) = store.records.iter_mut().find(|item| item.key == key) {
                        existing.value = value;
                    } else {
                        store.records.push(IndexedDbRecord { key, value });
                    }
                }
            }
            _ => return Err("unsupported profile migration export chunk kind".into()),
        }
        if snapshot_size(snapshot)? > MAX_MIGRATION_BYTES || added_bytes > MAX_MIGRATION_BYTES {
            state.exporting = false;
            state.snapshot = None;
            state.export_error = Some("Legacy storage exceeds migration size limit".into());
            return Err("legacy profile storage exceeds migration size limit".into());
        }
        Ok(())
    }

    pub fn finish_export(&self, migration_id: &str) -> Result<ProfileMigrationStatus, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if !state.exporting {
            return Err("profile migration export is not in progress".into());
        }
        let snapshot = state
            .snapshot
            .as_mut()
            .ok_or_else(|| "profile migration export has no initialized snapshot".to_string())?;
        if snapshot.migration_id != migration_id {
            return Err("profile migration id does not match export".into());
        }
        snapshot
            .local_storage
            .sort_by(|left, right| left.key.cmp(&right.key));
        let encoded = serde_json::to_vec(snapshot).map_err(|error| error.to_string())?;
        atomic_write(&self.migration_dir.join(SNAPSHOT_FILE), &encoded)?;
        state.exporting = false;
        state.source_active = false;
        state.export_error = None;
        let marker = serde_json::to_vec(&json!({"version":1,"sourceActive":false}))
            .map_err(|error| error.to_string())?;
        atomic_write(&self.migration_dir.join(STATE_FILE), &marker)?;
        Ok(status_for(&state, false, None))
    }

    pub fn ingest_export_chunk(&self, payload: Value) -> Result<ProfileMigrationStatus, String> {
        let object = payload
            .as_object()
            .ok_or_else(|| "profile migration chunk must be an object".to_string())?;
        let kind = object
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| "profile migration chunk is missing kind".to_string())?;
        match kind {
            "begin" => self.begin_export_from_chunk(payload),
            "localStorage" | "indexedDb" => {
                let migration_id = object
                    .get("migrationId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "profile migration chunk is missing migrationId".to_string())?;
                let records = object
                    .get("records")
                    .and_then(Value::as_array)
                    .ok_or_else(|| "profile migration chunk records must be an array".to_string())?
                    .clone();
                self.append_export_chunk(migration_id, kind, records)?;
                Ok(self.status())
            }
            "finish" => {
                let migration_id = object
                    .get("migrationId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "profile migration finish is missing migrationId".to_string())?;
                self.finish_export(migration_id)
            }
            _ => Err("unsupported profile migration chunk kind".into()),
        }
    }

    pub fn claim(
        &self,
        migration_id: &str,
        window_label: &str,
    ) -> Result<ProfileMigrationStatus, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if state.complete {
            return Ok(status_for(&state, true, None));
        }
        let snapshot_migration_id = checked_snapshot(&state, migration_id)?.migration_id.clone();
        if let Some(owner) = state.owner.as_ref() {
            if owner.window_label == window_label {
                return Ok(status_with_owner(
                    &state,
                    false,
                    None,
                    Some(owner.token.clone()),
                ));
            }
            return Ok(status_for(
                &state,
                false,
                Some("Another renderer owns the legacy profile migration".into()),
            ));
        }
        state.next_generation = state.next_generation.saturating_add(1);
        let generation = state.next_generation;
        let mut hasher = Sha256::new();
        hasher.update(snapshot_migration_id.as_bytes());
        hasher.update(window_label.as_bytes());
        hasher.update(generation.to_le_bytes());
        let token = hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        state.owner = Some(MigrationOwner {
            window_label: window_label.to_string(),
            token: token.clone(),
            generation,
        });
        Ok(status_with_owner(&state, false, None, Some(token)))
    }

    pub fn release(&self, token: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if state
            .owner
            .as_ref()
            .is_some_and(|owner| owner.token == token)
        {
            state.owner = None;
        }
        Ok(())
    }

    pub fn release_window(&self, window_label: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if state
            .owner
            .as_ref()
            .is_some_and(|owner| owner.window_label == window_label)
        {
            state.owner = None;
        }
        Ok(())
    }

    pub fn set_source_active(&self, active: bool) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        state.source_active = active;
        state.exporting = !active;
        state.export_error = None;
        let payload = serde_json::to_vec(&json!({
            "version": 1,
            "sourceActive": active,
        }))
        .map_err(|error| error.to_string())?;
        atomic_write(&self.migration_dir.join(STATE_FILE), &payload)
    }

    pub fn set_export_error(&self, error: impl Into<String>) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        state.source_active = false;
        state.exporting = false;
        state.snapshot = None;
        state.export_error = Some(error.into());
        let payload = serde_json::to_vec(&json!({
            "version": 1,
            "sourceActive": false,
            "error": state.export_error,
        }))
        .map_err(|error| error.to_string())?;
        atomic_write(&self.migration_dir.join(STATE_FILE), &payload)
    }

    pub fn status(&self) -> ProfileMigrationStatus {
        let state = self.state.lock().expect("profile migration state poisoned");
        if state.snapshot.is_none() {
            let marker_exists = self.migration_dir.join(MARKER_FILE).is_file();
            let status_state = if state.complete {
                "complete"
            } else if state.export_error.is_some() {
                "error"
            } else if state.source_active {
                "active"
            } else if state.exporting || marker_exists {
                "exporting"
            } else {
                "not-needed"
            };
            let message = state.export_error.clone().or_else(|| {
                if state.source_active {
                    Some(
                        "Quit the previous Superset instance before migrating its renderer profile"
                            .into(),
                    )
                } else if marker_exists {
                    Some("Legacy profile exists but its renderer snapshot is not ready".into())
                } else {
                    None
                }
            });
            return ProfileMigrationStatus {
                state: status_state.into(),
                migration_id: None,
                source_origin: Some(self.source_origin.clone()),
                target_origin: Some(self.target_origin.clone()),
                local_storage_count: 0,
                indexed_db: Vec::new(),
                message,
                owner_token: None,
                generation: None,
            };
        }
        if state.complete {
            return status_for(&state, true, None);
        }
        if state.source_active {
            return status_for(
                &state,
                false,
                Some(
                    "Quit the previous Superset instance before migrating its renderer profile"
                        .into(),
                ),
            );
        }
        if state.export_error.is_some() {
            return status_for(&state, false, state.export_error.clone());
        }
        if state.exporting {
            return status_for(&state, false, None);
        }
        status_for(&state, false, None)
    }

    pub fn local_storage_batch(
        &self,
        migration_id: &str,
        cursor: usize,
        limit: usize,
    ) -> Result<Batch<LocalStorageRecord>, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        let snapshot = checked_snapshot(&state, migration_id)?;
        let limit = checked_limit(limit)?;
        batch(&snapshot.local_storage, cursor, limit)
    }

    pub fn indexed_db_batch(
        &self,
        migration_id: &str,
        database: &str,
        store: &str,
        cursor: usize,
        limit: usize,
    ) -> Result<Batch<IndexedDbRecord>, String> {
        if database != "keyval-store" || store != "keyval" {
            return Err("Only the app keyval-store/keyval database is migratable".into());
        }
        let state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        let snapshot = checked_snapshot(&state, migration_id)?;
        let records = snapshot
            .indexed_db
            .iter()
            .find(|entry| entry.database == database && entry.store == store)
            .map(|entry| entry.records.as_slice())
            .unwrap_or(&[]);
        let limit = checked_limit(limit)?;
        batch(records, cursor, limit)
    }

    pub fn complete(
        &self,
        migration_id: &str,
        token: &str,
    ) -> Result<ProfileMigrationStatus, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "profile migration state was poisoned".to_string())?;
        if state.complete {
            return Ok(status_for(&state, true, None));
        }
        let snapshot = checked_snapshot(&state, migration_id)?;
        if state.owner.as_ref().map(|owner| owner.token.as_str()) != Some(token) {
            return Err("profile migration completion token is not owned by this renderer".into());
        }
        let marker = json!({
            "version": 1,
            "completed": true,
            "migrationId": snapshot.migration_id,
            "sourceOrigin": snapshot.source_origin.clone(),
            "targetOrigin": snapshot.target_origin.clone(),
        });
        let encoded = serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?;
        atomic_write(&self.migration_dir.join(COMPLETE_FILE), &encoded)?;
        state.complete = true;
        state.owner = None;
        Ok(status_for(&state, true, None))
    }
}

fn read_snapshot(path: &Path) -> Result<Option<ProfileMigrationSnapshot>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read(path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
    decode_persisted_snapshot(value).map(Some)
}

fn read_complete(
    path: &Path,
    snapshot: Option<&ProfileMigrationSnapshot>,
    source_origin: &str,
    target_origin: &str,
) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let raw = fs::read(path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| "profile migration completion marker must be an object".to_string())?;
    if object.get("version").and_then(Value::as_u64) != Some(1)
        || object.get("completed").and_then(Value::as_bool) != Some(true)
    {
        return Err("profile migration completion marker is invalid".into());
    }
    let marker_id = object
        .get("migrationId")
        .and_then(Value::as_str)
        .ok_or_else(|| "profile migration completion marker is missing migrationId".to_string())?;
    let snapshot = snapshot.ok_or_else(|| {
        "profile migration completion marker exists without a snapshot".to_string()
    })?;
    if marker_id != snapshot.migration_id {
        return Err("profile migration completion marker does not match snapshot".into());
    }
    let marker_source = object
        .get("sourceOrigin")
        .and_then(Value::as_str)
        .ok_or_else(|| "profile migration completion marker is missing sourceOrigin".to_string())?;
    if marker_source != source_origin || snapshot.source_origin != source_origin {
        return Err("profile migration completion marker source does not match".into());
    }
    let marker_target = object
        .get("targetOrigin")
        .and_then(Value::as_str)
        .ok_or_else(|| "profile migration completion marker is missing targetOrigin".to_string())?;
    if marker_target != target_origin || snapshot.target_origin != target_origin {
        return Err("profile migration completion marker target does not match".into());
    }
    Ok(true)
}

fn decode_persisted_snapshot(value: Value) -> Result<ProfileMigrationSnapshot, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "persisted profile migration snapshot must be an object".to_string())?;
    if !object.get("localStorage").is_some_and(Value::is_array)
        || !object.get("indexedDb").is_some_and(Value::is_array)
    {
        return Err("persisted profile migration snapshot has invalid record shapes".into());
    }
    let snapshot: ProfileMigrationSnapshot =
        serde_json::from_value(value).map_err(|error| error.to_string())?;
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn normalize_export(export: Value) -> Result<ProfileMigrationSnapshot, String> {
    let object = export
        .as_object()
        .ok_or_else(|| "profile migration export must be an object".to_string())?;
    let version = object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| "profile migration export is missing version".to_string())?;
    if version != 1 {
        return Err(format!("unsupported profile migration version {version}"));
    }
    let source_origin = required_string(object, "sourceOrigin")?;
    let target_origin = required_string(object, "targetOrigin")?;
    let migration_id = object
        .get("migrationId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            let bytes = serde_json::to_vec(&export).unwrap_or_default();
            let digest = Sha256::digest(bytes);
            digest.iter().map(|byte| format!("{byte:02x}")).collect()
        });

    let local_storage = parse_local_storage(object.get("localStorage"))?;
    let indexed_db = parse_indexed_db(object.get("indexedDB"))?;
    let snapshot = ProfileMigrationSnapshot {
        version: version as u32,
        migration_id,
        source_origin,
        target_origin,
        local_storage,
        indexed_db,
    };
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn validate_snapshot(snapshot: &ProfileMigrationSnapshot) -> Result<(), String> {
    if snapshot.version != 1 {
        return Err("unsupported persisted profile migration version".into());
    }
    validate_origin(&snapshot.source_origin)?;
    validate_origin(&snapshot.target_origin)?;
    if snapshot.migration_id.is_empty() {
        return Err("profile migration snapshot is missing migrationId".into());
    }
    Ok(())
}

fn validate_origins(
    snapshot: &ProfileMigrationSnapshot,
    source_origin: &str,
    target_origin: &str,
) -> Result<(), String> {
    if snapshot.source_origin != source_origin {
        return Err("profile migration source origin does not match this app profile".into());
    }
    if snapshot.target_origin != target_origin {
        return Err("profile migration target origin does not match this app".into());
    }
    Ok(())
}

fn validate_origin(origin: &str) -> Result<(), String> {
    if origin == "file://" {
        return Ok(());
    }
    let parsed =
        url::Url::parse(origin).map_err(|_| "profile migration origin is invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != origin
    {
        return Err("profile migration origin must be an exact HTTP(S) origin".into());
    }
    Ok(())
}

fn parse_local_storage(value: Option<&Value>) -> Result<Vec<LocalStorageRecord>, String> {
    let object = value
        .ok_or_else(|| "profile migration export is missing localStorage".to_string())?
        .as_object()
        .ok_or_else(|| "profile migration localStorage must be an object".to_string())?;
    let mut records = Vec::new();
    for (key, value) in object {
        let value = value
            .as_str()
            .ok_or_else(|| format!("localStorage value for {key} is not a string"))?;
        if !allowed_local_storage_key(key) {
            continue;
        }
        ensure_record_size(key, value)?;
        records.push(LocalStorageRecord {
            key: key.clone(),
            value: value.to_string(),
        });
    }
    records.sort_by(|left, right| left.key.cmp(&right.key));
    Ok(records)
}

fn parse_indexed_db(value: Option<&Value>) -> Result<Vec<IndexedDbStore>, String> {
    let databases = value
        .ok_or_else(|| "profile migration export is missing indexedDB".to_string())?
        .as_object()
        .ok_or_else(|| "profile migration indexedDB must be an object".to_string())?;
    for (name, database) in databases {
        if !database.is_object() {
            return Err(format!("IndexedDB database {name} must be an object"));
        }
    }
    let Some(database) = databases.get("keyval-store") else {
        return Ok(Vec::new());
    };
    let database = database
        .as_object()
        .ok_or_else(|| "keyval-store database must be an object".to_string())?;
    let stores = database
        .get("stores")
        .ok_or_else(|| "keyval-store database is missing stores".to_string())?
        .as_object()
        .ok_or_else(|| "keyval-store stores must be an object".to_string())?;
    let Some(records) = stores.get("keyval") else {
        return Ok(Vec::new());
    };
    let records = records
        .as_array()
        .ok_or_else(|| "keyval store records must be an array".to_string())?;
    let mut parsed = Vec::new();
    for record in records {
        let object = record
            .as_object()
            .ok_or_else(|| "keyval record must be an object".to_string())?;
        let key = object
            .get("key")
            .cloned()
            .ok_or_else(|| "keyval record is missing key".to_string())?;
        let value = object
            .get("value")
            .cloned()
            .ok_or_else(|| "keyval record is missing value".to_string())?;
        ensure_record_size(&key.to_string(), &value.to_string())?;
        parsed.push(IndexedDbRecord { key, value });
    }
    Ok(vec![IndexedDbStore {
        database: "keyval-store".into(),
        store: "keyval".into(),
        records: parsed,
    }])
}

fn required_string(object: &Map<String, Value>, key: &str) -> Result<String, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("profile migration export is missing {key}"))
}

fn ensure_record_size(key: &str, value: &str) -> Result<(), String> {
    if key.len().saturating_add(value.len()) > MAX_RECORD_BYTES {
        return Err("profile migration record exceeds size limit".into());
    }
    Ok(())
}

fn snapshot_size(snapshot: &ProfileMigrationSnapshot) -> Result<usize, String> {
    serde_json::to_vec(snapshot)
        .map(|bytes| bytes.len())
        .map_err(|error| error.to_string())
}

fn checked_snapshot<'a>(
    state: &'a MigrationState,
    migration_id: &str,
) -> Result<&'a ProfileMigrationSnapshot, String> {
    if state.source_active {
        return Err("legacy profile is still active".into());
    }
    if state.exporting {
        return Err("legacy profile snapshot is still exporting".into());
    }
    if state.export_error.is_some() {
        return Err(state.export_error.clone().unwrap_or_default());
    }
    let snapshot = state
        .snapshot
        .as_ref()
        .ok_or_else(|| "profile migration snapshot is not ready".to_string())?;
    if snapshot.migration_id != migration_id {
        return Err("profile migration id does not match the ready snapshot".into());
    }
    Ok(snapshot)
}

fn checked_limit(limit: usize) -> Result<usize, String> {
    if limit == 0 || limit > MAX_BATCH {
        return Err(format!(
            "profile migration batch limit must be 1..={MAX_BATCH}"
        ));
    }
    Ok(limit)
}

fn batch<T: Clone + Serialize>(
    records: &[T],
    cursor: usize,
    limit: usize,
) -> Result<Batch<T>, String> {
    let total = records.len();
    let mut batch = Vec::new();
    let mut bytes = 0usize;
    for record in records.iter().skip(cursor).take(limit) {
        let record_bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        if record_bytes.len() > MAX_RECORD_BYTES {
            return Err("profile migration record exceeds size limit".into());
        }
        if !batch.is_empty() && bytes.saturating_add(record_bytes.len()) > MAX_BATCH_BYTES {
            break;
        }
        if batch.is_empty() && record_bytes.len() > MAX_BATCH_BYTES {
            return Err("profile migration batch record exceeds byte limit".into());
        }
        bytes = bytes.saturating_add(record_bytes.len());
        batch.push(record.clone());
    }
    if batch.is_empty() && cursor < total {
        return Err("profile migration batch could not fit a record".into());
    }
    let next_cursor = (cursor + batch.len() < total).then_some(cursor + batch.len());
    Ok(Batch {
        records: batch,
        next_cursor,
    })
}

fn status_for(
    state: &MigrationState,
    complete: bool,
    message: Option<String>,
) -> ProfileMigrationStatus {
    status_with_owner(state, complete, message, None)
}

fn status_with_owner(
    state: &MigrationState,
    complete: bool,
    message: Option<String>,
    owner_token: Option<String>,
) -> ProfileMigrationStatus {
    let Some(snapshot) = state.snapshot.as_ref() else {
        return ProfileMigrationStatus {
            state: if complete {
                "complete"
            } else if state.export_error.is_some() {
                "error"
            } else if state.source_active {
                "active"
            } else if state.exporting {
                "exporting"
            } else {
                "not-needed"
            }
            .into(),
            migration_id: None,
            source_origin: None,
            target_origin: None,
            local_storage_count: 0,
            indexed_db: Vec::new(),
            message: message.or_else(|| state.export_error.clone()),
            owner_token: None,
            generation: None,
        };
    };
    let waiting = !complete && state.owner.is_some() && owner_token.is_none();
    ProfileMigrationStatus {
        state: if complete {
            "complete"
        } else if state.source_active {
            "active"
        } else if state.export_error.is_some() {
            "error"
        } else if state.exporting {
            "exporting"
        } else if waiting {
            "waiting"
        } else {
            "ready"
        }
        .into(),
        migration_id: Some(snapshot.migration_id.clone()),
        source_origin: Some(snapshot.source_origin.clone()),
        target_origin: Some(snapshot.target_origin.clone()),
        local_storage_count: snapshot.local_storage.len(),
        indexed_db: snapshot
            .indexed_db
            .iter()
            .map(|store| IndexedDbStoreStatus {
                database: store.database.clone(),
                store: store.store.clone(),
                count: store.records.len(),
            })
            .collect(),
        message,
        owner_token,
        generation: state.owner.as_ref().map(|owner| owner.generation),
    }
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "profile migration path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.create(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    file.set_len(0).map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn allowed_local_storage_key(key: &str) -> bool {
    const EXACT: &[&str] = &[
        "router-history",
        "tabs-storage",
        "theme-storage",
        "theme-terminal",
        "theme-id",
        "theme-type",
        "ringtone-storage",
        "settings",
        "markdown-preferences",
        "file-explorer-store",
        "ports-store",
        "search-dialog-store",
        "sidebar-store",
        "new-workspace-width",
        "workspace-sidebar-store",
        "sidebar-workspaces-collapse",
        "organization-switcher-order-v1",
        "last-active-v2-workspace",
        "recent-v2-workspaces",
        "v2-local-override-v2",
        "v2-workspace-create-defaults",
        "v2-project-local-meta",
        "v2-changes-sections-v1",
        "v2-notifications-v1",
        "v2-pane-scroll-state-v1",
        "v2-workspaces-view",
        "changes-store",
        "prompt-history",
        "terminal-buffer-persisted-at",
        "hiring-banner-v1",
        "star-nag-v1",
        "terminal-close-confirm-v1",
        "automation-failures-v1",
        "app-version-history-v1",
        "desktop-notice-dismissals-v1",
        "v2-setup-card-dismissals-v1",
        "browser-import-banner-dismissals-v1",
        "workspace-agents-row",
        "usage-last-section-v1",
        "leaderboard-card-collapsed-v1",
        "inline-workspace-ports",
        "hotkey-overrides",
        "keyboard-preferences",
        "tasks-filter-state",
        "pull-requests-filter-state",
        "pull-requests-split-view-state",
        "active_organization_id",
        "leaderboard-auto-publish-v2",
        "lastSelectedV2WorkspaceCreateModelByPreset",
        "lastSelectedV2WorkspaceCreateEffortByPreset",
        "lastSelectedV2WorkspaceCreateModeByPreset",
        "lastSelectedV2WorkspaceCreateAgent",
        "lastOpenedInProjectId",
        "lastSelectedAgent",
        "agentAutoRun",
        "lastViewedWorkspaceId",
        "superset.terminalRichInputOpen",
        "lastSelectedDiffCommentNewAgentConfigId",
        "lastSelectedDiffCommentPlacement",
        "lastSelectedV2TaskAgent",
        "lastSelectedV2IssueBatchAgent",
        "lastSelectedV2TaskBatchAgent",
        "superset-last-auth-method",
        "superset:dev:v2-sidebar-seeded",
    ];
    if EXACT.contains(&key) {
        return true;
    }
    const PREFIXES: &[&str] = &[
        "v2-workspace-local-state-",
        "v2-sidebar-projects-",
        "v2-sidebar-sections-",
        "v2-terminal-presets-",
        "v2-user-preferences-",
        "failed-workspace-creates-",
        "terminal-buffer:",
        "terminal-dims:",
        "terminal-seq:",
        "v1-migration-complete-",
        "v1-migration-continuity-pending-",
        "v1-migration-welcome-pending-",
        "v1-migration-followup-pending-",
        "chat-v3-draft:",
        "daemon-update-dismissed-failure-",
    ];
    PREFIXES.iter().any(|prefix| key.starts_with(prefix))
        || (key.starts_with("ph_") && key.ends_with("_posthog"))
        || key.starts_with("__ph_opt_in_out_")
        || ["tabs", "theme", "ringtone"]
            .iter()
            .any(|name| key.starts_with(&format!("{name}:")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "superset-profile-migration-{}-{}-{}",
            std::process::id(),
            NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_restricts_snapshot_permissions_and_replaces_existing_files() {
        let root = temp_dir();
        fs::create_dir_all(&root).unwrap();
        let snapshot = root.join(SNAPSHOT_FILE);
        fs::write(&snapshot, b"previous snapshot").unwrap();
        fs::set_permissions(&snapshot, fs::Permissions::from_mode(0o644)).unwrap();

        let temporary = snapshot.with_extension("tmp");
        fs::write(&temporary, b"interrupted previous snapshot").unwrap();
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o644)).unwrap();

        atomic_write(&snapshot, b"replacement snapshot").unwrap();

        assert_eq!(fs::read(&snapshot).unwrap(), b"replacement snapshot");
        assert_eq!(
            fs::metadata(&snapshot).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    fn export() -> Value {
        json!({
            "version": 1,
            "migrationId": "migration-1",
            "sourceOrigin": "file://",
            "targetOrigin": "https://tauri.localhost",
            "localStorage": {
                "router-history": "{\"index\":1}",
                "guest-cookie": "secret",
                "v2-sidebar-projects-org": "{\"pinned\":true}",
                "organization-switcher-order-v1": "[\"org-1\"]",
                "recent-v2-workspaces": "[\"workspace-1\"]"
            },
            "indexedDB": {
                "keyval-store": {
                    "version": 1,
                    "stores": {
                        "keyval": [{
                            "key": "host-workspaces:v1:org:machine",
                            "value": {"json": {"at": "2026-09-21T00:00:00.000Z"}, "meta": {"values": {"at": ["Date"]}, "v": 1}}
                        }]
                    }
                },
                "guest-db": {"stores": {"cookies": []}}
            }
        })
    }

    #[test]
    fn filters_guest_storage_and_batches_allowlisted_records() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        fs::write(root.join("migration").join(MARKER_FILE), b"{}").unwrap();
        let migration = ProfileMigration::new(&root).unwrap();
        let status = migration.ingest_export(export()).unwrap();
        assert_eq!(status.state, "ready");
        assert_eq!(status.local_storage_count, 4);
        assert_eq!(status.indexed_db[0].count, 1);
        let first_owner = migration.claim("migration-1", "main").unwrap();
        assert_eq!(first_owner.state, "ready");
        let waiting = migration.claim("migration-1", "window-2").unwrap();
        assert_eq!(waiting.state, "waiting");
        migration
            .release(first_owner.owner_token.as_deref().unwrap())
            .unwrap();
        assert_eq!(
            migration.claim("migration-1", "window-2").unwrap().state,
            "ready"
        );
        let batch = migration.local_storage_batch("migration-1", 0, 1).unwrap();
        assert_eq!(batch.records.len(), 1);
        assert_eq!(batch.next_cursor, Some(1));
        let records = migration
            .local_storage_batch("migration-1", 0, MAX_BATCH)
            .unwrap()
            .records;
        assert!(records.iter().any(|record| {
            record.key == "organization-switcher-order-v1" && record.value == "[\"org-1\"]"
        }));
        assert!(records.iter().any(|record| {
            record.key == "recent-v2-workspaces" && record.value == "[\"workspace-1\"]"
        }));
        assert!(!records.iter().any(|record| record.key == "guest-cookie"));
        assert!(
            migration
                .indexed_db_batch("migration-1", "guest-db", "cookies", 0, 1)
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completion_is_durable_and_idempotent() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        let migration = ProfileMigration::new(&root).unwrap();
        migration.ingest_export(export()).unwrap();
        let token = migration
            .claim("migration-1", "main")
            .unwrap()
            .owner_token
            .unwrap();
        assert_eq!(
            migration.complete("migration-1", &token).unwrap().state,
            "complete"
        );
        assert_eq!(
            migration.complete("migration-1", &token).unwrap().state,
            "complete"
        );
        let reloaded = ProfileMigration::new(&root).unwrap();
        assert_eq!(reloaded.status().state, "complete");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reloads_persisted_snapshot_without_dropping_records() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        let migration = ProfileMigration::new(&root).unwrap();
        migration.ingest_export(export()).unwrap();
        drop(migration);
        let reloaded = ProfileMigration::new(&root).unwrap();
        let status = reloaded.status();
        assert_eq!(status.state, "ready");
        assert_eq!(status.local_storage_count, 4);
        assert_eq!(status.indexed_db[0].count, 1);
        assert_eq!(
            reloaded
                .local_storage_batch("migration-1", 0, 128)
                .unwrap()
                .records
                .len(),
            4
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn binds_dev_snapshot_to_exact_source_and_target_origins() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        let source_origin = "http://localhost:5173";
        let target_origin = "http://127.0.0.1:5173";
        let migration =
            ProfileMigration::new_with_origins(&root, source_origin, target_origin).unwrap();
        let mut snapshot = export();
        snapshot["sourceOrigin"] = Value::String(source_origin.into());
        snapshot["targetOrigin"] = Value::String(target_origin.into());
        let status = migration.ingest_export(snapshot).unwrap();
        assert_eq!(status.source_origin.as_deref(), Some(source_origin));
        assert_eq!(status.target_origin.as_deref(), Some(target_origin));
        drop(migration);

        let reloaded =
            ProfileMigration::new_with_origins(&root, source_origin, target_origin).unwrap();
        assert_eq!(reloaded.status().state, "ready");
        assert!(
            ProfileMigration::new_with_origins(&root, source_origin, "https://tauri.localhost")
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_expected_origins_before_export_begins() {
        let root = temp_dir();
        fs::create_dir_all(&root).unwrap();
        let migration = ProfileMigration::new_for_runtime(&root, Some(5173)).unwrap();
        let status = migration.status();
        assert_eq!(status.state, "not-needed");
        assert_eq!(
            status.source_origin.as_deref(),
            Some("http://localhost:5173")
        );
        assert_eq!(
            status.target_origin.as_deref(),
            Some("http://127.0.0.1:5173")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_corrupt_completion_marker_and_distinguishes_exporting_source() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        fs::write(root.join("migration").join(MARKER_FILE), b"{}").unwrap();
        let migration = ProfileMigration::new(&root).unwrap();
        assert_eq!(migration.status().state, "exporting");
        migration.set_source_active(true).unwrap();
        assert_eq!(migration.status().state, "active");
        migration.set_source_active(false).unwrap();
        migration.ingest_export(export()).unwrap();
        fs::write(
            root.join("migration").join(COMPLETE_FILE),
            br#"{"version":1,"completed":true}"#,
        )
        .unwrap();
        assert!(ProfileMigration::new(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_snapshot_cannot_be_imported_while_source_is_active_or_reexporting() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        let migration = ProfileMigration::new(&root).unwrap();
        migration.ingest_export(export()).unwrap();

        migration.set_source_active(true).unwrap();
        assert_eq!(migration.status().state, "active");
        assert!(
            migration
                .local_storage_batch("migration-1", 0, 128)
                .is_err()
        );
        assert!(migration.claim("migration-1", "main").is_err());

        migration.set_source_active(false).unwrap();
        assert_eq!(migration.status().state, "exporting");
        assert!(
            migration
                .local_storage_batch("migration-1", 0, 128)
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn batch_is_bounded_by_serialized_bytes_as_well_as_count() {
        let records = vec![
            LocalStorageRecord {
                key: "a".into(),
                value: "x".repeat(3 * 1024 * 1024),
            },
            LocalStorageRecord {
                key: "b".into(),
                value: "x".repeat(3 * 1024 * 1024),
            },
            LocalStorageRecord {
                key: "c".into(),
                value: "x".repeat(3 * 1024 * 1024),
            },
        ];
        let batch = batch(&records, 0, MAX_BATCH).unwrap();
        assert_eq!(batch.records.len(), 2);
        assert_eq!(batch.next_cursor, Some(2));
    }

    #[test]
    fn rejects_malformed_export_shapes_instead_of_importing_empty_state() {
        let root = temp_dir();
        fs::create_dir_all(root.join("migration")).unwrap();
        let migration = ProfileMigration::new(&root).unwrap();
        let mut malformed = export();
        malformed["localStorage"] = Value::Null;
        assert!(migration.ingest_export(malformed).is_err());
        let mut malformed_idb = export();
        malformed_idb["indexedDB"]["keyval-store"]["stores"]["keyval"] =
            Value::String("not-an-array".into());
        assert!(migration.ingest_export(malformed_idb).is_err());
        let mut mismatched_origin = export();
        mismatched_origin["targetOrigin"] = Value::String("http://tauri.localhost/".into());
        assert!(migration.ingest_export(mismatched_origin).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
