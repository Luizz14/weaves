//! Native filesystem actions used by the Node host.
//!
//! The Node contracts intentionally mirror Electron: opening a path returns
//! an empty string on success and an error string on failure, revealing an
//! item returns no value, and trashing an item is recoverable. The dispatcher
//! remains in `shell.rs`; this module only validates paths, builds the
//! platform command and executes it.

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: &'static str,
    pub args: Vec<String>,
}

pub fn validate_existing_absolute_path(path: &str, key: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.exists() {
        return Err(format!("{key} must be an existing absolute path"));
    }
    Ok(path)
}

pub fn open_path_command(path: &Path) -> CommandSpec {
    #[cfg(target_os = "macos")]
    {
        return CommandSpec {
            program: "open",
            args: vec![path.to_string_lossy().into_owned()],
        };
    }
    #[cfg(target_os = "linux")]
    {
        return CommandSpec {
            program: "xdg-open",
            args: vec![path.to_string_lossy().into_owned()],
        };
    }
    #[cfg(target_os = "windows")]
    {
        return CommandSpec {
            program: "cmd",
            args: vec![
                "/C".into(),
                "start".into(),
                "".into(),
                path.to_string_lossy().into_owned(),
            ],
        };
    }
    #[allow(unreachable_code)]
    CommandSpec {
        program: "false",
        args: vec!["unsupported platform".into()],
    }
}

pub fn reveal_path_command(path: &Path) -> CommandSpec {
    #[cfg(target_os = "macos")]
    {
        return CommandSpec {
            program: "open",
            args: vec!["-R".into(), path.to_string_lossy().into_owned()],
        };
    }
    #[cfg(target_os = "linux")]
    {
        return CommandSpec {
            program: "xdg-open",
            args: vec![path.parent().unwrap_or(path).to_string_lossy().into_owned()],
        };
    }
    #[cfg(target_os = "windows")]
    {
        return CommandSpec {
            program: "explorer",
            args: vec![format!("/select,{}", path.to_string_lossy())],
        };
    }
    #[allow(unreachable_code)]
    CommandSpec {
        program: "false",
        args: vec!["unsupported platform".into()],
    }
}

pub fn trash_path_command(path: &Path) -> CommandSpec {
    #[cfg(target_os = "macos")]
    {
        return CommandSpec {
            // macOS runtime uses NSFileManager directly; keep a descriptive
            // spec for platform-independent command-shape tests only.
            program: "__native_nsfilemanager_trash",
            args: vec![path.to_string_lossy().into_owned()],
        };
    }
    #[cfg(target_os = "linux")]
    {
        return CommandSpec {
            program: "gio",
            args: vec!["trash".into(), path.to_string_lossy().into_owned()],
        };
    }
    #[cfg(target_os = "windows")]
    {
        return CommandSpec {
            program: "powershell",
            args: vec![
                "-NoProfile".into(),
                "-Command".into(),
                format!(
                    "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{}', 'OnlyErrorDialogs', 'SendToRecycleBin')",
                    powershell_single_quote(path.to_string_lossy().as_ref())
                ),
            ],
        };
    }
    #[allow(unreachable_code)]
    CommandSpec {
        program: "false",
        args: vec!["unsupported platform".into()],
    }
}

pub fn open_path(path: &Path) -> String {
    electron_open_path_result(run_command(open_path_command(path), "failed to open path"))
}

pub fn electron_open_path_result(result: Result<String, String>) -> String {
    result.unwrap_or_else(|error| error)
}

pub fn show_item_in_folder(path: &Path) -> Result<(), String> {
    run_command(reveal_path_command(path), "failed to reveal path").map(|_| ())
}

pub fn trash_item(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return trash_item_macos(path);
    }
    #[cfg(not(target_os = "macos"))]
    {
        run_command(trash_path_command(path), "failed to move path to Trash").map(|_| ())
    }
}

fn run_command(spec: CommandSpec, operation: &str) -> Result<String, String> {
    let output = Command::new(spec.program)
        .args(spec.args)
        .output()
        .map_err(|error| format!("{operation}: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("{operation}: command exited with {}", output.status)
        } else {
            format!("{operation}: {detail}")
        });
    }
    Ok(String::new())
}

#[cfg(target_os = "macos")]
fn trash_item_macos(path: &Path) -> Result<(), String> {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_void};
    use std::ptr::null_mut;

    #[link(name = "Foundation", kind = "framework")]
    unsafe extern "C" {}

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
    }

    type SendNoArgs = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
    type SendCString = unsafe extern "C" fn(*mut c_void, *mut c_void, *const c_char) -> *mut c_void;
    type SendObject = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void;
    type SendTrash = unsafe extern "C" fn(
        *mut c_void,
        *mut c_void,
        *mut c_void,
        *mut *mut c_void,
        *mut *mut c_void,
    ) -> bool;
    type SendUtf8String = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *const c_char;

    let class = |name: &str| -> Result<*mut c_void, String> {
        let name = CString::new(name).map_err(|_| "invalid Objective-C class".to_string())?;
        let class = unsafe { objc_getClass(name.as_ptr()) };
        if class.is_null() {
            Err(format!("Objective-C class {name:?} is unavailable"))
        } else {
            Ok(class)
        }
    };
    let selector = |name: &str| -> Result<*mut c_void, String> {
        let name = CString::new(name).map_err(|_| "invalid Objective-C selector".to_string())?;
        let selector = unsafe { sel_registerName(name.as_ptr()) };
        if selector.is_null() {
            Err(format!("Objective-C selector {name:?} is unavailable"))
        } else {
            Ok(selector)
        }
    };

    let pool_class = class("NSAutoreleasePool")?;
    let alloc = selector("alloc")?;
    let init = selector("init")?;
    let release = selector("release")?;
    let pool = unsafe {
        let send: SendNoArgs =
            std::mem::transmute::<*const (), SendNoArgs>(objc_msgSend as *const ());
        let allocated = send(pool_class, alloc);
        if allocated.is_null() {
            return Err("NSAutoreleasePool allocation failed".into());
        }
        send(allocated, init)
    };
    if pool.is_null() {
        return Err("NSAutoreleasePool initialization failed".into());
    }

    let result = (|| {
        let path = CString::new(path.to_string_lossy().as_bytes())
            .map_err(|_| "path contains an invalid NUL byte".to_string())?;
        let ns_string_class = class("NSString")?;
        let string_with_utf8 = selector("stringWithUTF8String:")?;
        let url_class = class("NSURL")?;
        let file_url_with_path = selector("fileURLWithPath:")?;
        let file_manager_class = class("NSFileManager")?;
        let default_manager = selector("defaultManager")?;
        let trash = selector("trashItemAtURL:resultingItemURL:error:")?;

        let ns_path = unsafe {
            let send: SendCString =
                std::mem::transmute::<*const (), SendCString>(objc_msgSend as *const ());
            send(ns_string_class, string_with_utf8, path.as_ptr())
        };
        if ns_path.is_null() {
            return Err("NSString path construction failed".into());
        }
        let file_url = unsafe {
            let send: SendObject =
                std::mem::transmute::<*const (), SendObject>(objc_msgSend as *const ());
            send(url_class, file_url_with_path, ns_path)
        };
        if file_url.is_null() {
            return Err("NSURL path construction failed".into());
        }
        let manager = unsafe {
            let send: SendNoArgs =
                std::mem::transmute::<*const (), SendNoArgs>(objc_msgSend as *const ());
            send(file_manager_class, default_manager)
        };
        if manager.is_null() {
            return Err("NSFileManager is unavailable".into());
        }
        let mut resulting_url = null_mut();
        let mut error = null_mut();
        let success = unsafe {
            let send: SendTrash =
                std::mem::transmute::<*const (), SendTrash>(objc_msgSend as *const ());
            send(manager, trash, file_url, &mut resulting_url, &mut error)
        };
        if success {
            Ok(())
        } else {
            let detail = unsafe {
                if error.is_null() {
                    None
                } else {
                    let localized_description = selector("localizedDescription")?;
                    let utf8_string = selector("UTF8String")?;
                    let send_no_args: SendNoArgs =
                        std::mem::transmute::<*const (), SendNoArgs>(objc_msgSend as *const ());
                    let description = send_no_args(error, localized_description);
                    if description.is_null() {
                        None
                    } else {
                        let send_utf8: SendUtf8String =
                            std::mem::transmute::<*const (), SendUtf8String>(
                                objc_msgSend as *const (),
                            );
                        let bytes = send_utf8(description, utf8_string);
                        (!bytes.is_null())
                            .then(|| CStr::from_ptr(bytes).to_string_lossy().into_owned())
                    }
                }
            };
            Err(detail.unwrap_or_else(|| "NSFileManager could not move the item to Trash".into()))
        }
    })();

    unsafe {
        let send: SendObject =
            std::mem::transmute::<*const (), SendObject>(objc_msgSend as *const ());
        send(pool, release, null_mut());
    }
    result
}

#[cfg(target_os = "windows")]
fn powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::{
        electron_open_path_result, open_path_command, reveal_path_command, trash_path_command,
        validate_existing_absolute_path,
    };
    use std::path::Path;

    #[test]
    fn rejects_relative_and_missing_paths_before_spawning() {
        assert!(validate_existing_absolute_path("relative/file.txt", "path").is_err());
        assert!(validate_existing_absolute_path("/definitely/not/a/real/path", "path").is_err());
    }

    #[test]
    fn open_command_targets_the_exact_path() {
        let path = Path::new("/tmp/superset path.txt");
        let command = open_path_command(path);
        assert_eq!(
            command.args.last().map(String::as_str),
            Some(path.to_str().unwrap())
        );
    }

    #[test]
    fn open_path_result_matches_electron_empty_or_error_string_contract() {
        assert_eq!(electron_open_path_result(Ok(String::new())), "");
        assert_eq!(
            electron_open_path_result(Err("file opener failed".into())),
            "file opener failed"
        );
    }

    #[test]
    fn reveal_command_preserves_the_exact_path() {
        let path = Path::new("/tmp/superset path.txt");
        let command = reveal_path_command(path);
        assert!(command
            .args
            .iter()
            .any(|arg| arg.contains("superset path.txt")));
    }

    #[test]
    fn trash_command_is_recoverable_and_never_rm() {
        let command = trash_path_command(Path::new("/tmp/superset path.txt"));
        assert_ne!(command.program, "rm");
        assert!(!command.args.iter().any(|arg| arg == "-rf"));
    }
}
