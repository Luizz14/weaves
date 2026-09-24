use crate::node_host::NodeHost;
use serde_json::Value;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
const DISMISS_CATEGORY_IDENTIFIER: &str = "superset.native.dismiss";

#[cfg(any(target_os = "macos", test))]
const DEFAULT_ACTION_IDENTIFIER: &str = "com.apple.UNNotificationDefaultActionIdentifier";
#[cfg(any(target_os = "macos", test))]
const DISMISS_ACTION_IDENTIFIER: &str = "com.apple.UNNotificationDismissActionIdentifier";

#[cfg(target_os = "macos")]
static NOTIFICATION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationOptions {
    pub title: String,
    pub subtitle: Option<String>,
    pub body: String,
    pub silent: bool,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResponseAction {
    Click,
    Dismiss,
    Other,
}

pub fn parse_notification_options(params: &Value) -> Result<NotificationOptions, String> {
    let options = params
        .as_object()
        .ok_or_else(|| "notification.show params must be an object".to_string())?;
    let title = options
        .get("title")
        .and_then(Value::as_str)
        .filter(|title| !title.is_empty())
        .ok_or_else(|| "notification.show requires a non-empty title".to_string())?;
    let body = options
        .get("body")
        .and_then(Value::as_str)
        .ok_or_else(|| "notification.show requires a body string".to_string())?;
    let silent = options
        .get("silent")
        .and_then(Value::as_bool)
        .ok_or_else(|| "notification.show requires a silent boolean".to_string())?;
    let subtitle = match options.get("subtitle") {
        None => None,
        Some(Value::String(subtitle)) => Some(subtitle.clone()),
        Some(_) => return Err("notification.show subtitle must be a string".into()),
    };

    Ok(NotificationOptions {
        title: title.to_string(),
        subtitle,
        body: body.to_string(),
        silent,
    })
}

pub const fn is_supported() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(any(target_os = "macos", test))]
fn notification_id(process_id: u32, counter: u64) -> String {
    format!("superset.native.{process_id}.{counter}")
}

#[cfg(target_os = "macos")]
fn next_notification_id() -> String {
    notification_id(
        std::process::id(),
        NOTIFICATION_COUNTER.fetch_add(1, Ordering::Relaxed),
    )
}

#[cfg(any(target_os = "macos", test))]
fn response_action(
    action_identifier: &str,
    default_action_identifier: &str,
    dismiss_action_identifier: &str,
) -> ResponseAction {
    if action_identifier == default_action_identifier {
        ResponseAction::Click
    } else if action_identifier == dismiss_action_identifier {
        ResponseAction::Dismiss
    } else {
        ResponseAction::Other
    }
}

#[cfg(any(target_os = "macos", test))]
fn response_events(action: ResponseAction) -> &'static [&'static str] {
    match action {
        ResponseAction::Click => &["notification:click", "notification:closed"],
        ResponseAction::Dismiss => &["notification:closed"],
        ResponseAction::Other => &[],
    }
}

fn parse_notification_id(params: &Value) -> Result<String, String> {
    params
        .as_object()
        .and_then(|options| options.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "notification.close requires a non-empty id".into())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{
        DEFAULT_ACTION_IDENTIFIER, DISMISS_ACTION_IDENTIFIER, DISMISS_CATEGORY_IDENTIFIER,
        NotificationOptions, ResponseAction, next_notification_id, parse_notification_id,
        parse_notification_options, response_action, response_events,
    };
    use crate::node_host::NodeHost;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{AnyThread, ClassType, MainThreadMarker, define_class, msg_send};
    use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction,
        UNNotificationCategory, UNNotificationCategoryOptions, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationResponse, UNNotificationSound,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use serde_json::{Value, json};
    use std::cell::RefCell;
    use std::sync::{Mutex, OnceLock, mpsc};
    use tauri::{AppHandle, Runtime};

    static NODE_HOST: OnceLock<Mutex<Option<NodeHost>>> = OnceLock::new();

    thread_local! {
        static DELEGATE: RefCell<Option<Retained<NotificationDelegate>>> = const { RefCell::new(None) };
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = AnyThread]
        struct NotificationDelegate;

        unsafe impl NSObjectProtocol for NotificationDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present_notification(
                &self,
                _center: &UNUserNotificationCenter,
                notification: &UNNotification,
                completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                let mut options = UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List;
                if notification.request().content().sound().is_some() {
                    options |= UNNotificationPresentationOptions::Sound;
                }
                completion_handler.call((options,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive_notification_response(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion_handler: &block2::DynBlock<dyn Fn()>,
            ) {
                let request = response.notification().request();
                let is_ours = request.content().categoryIdentifier().to_string()
                    == DISMISS_CATEGORY_IDENTIFIER;

                if is_ours {
                    let action_identifier = response.actionIdentifier().to_string();
                    let action = response_action(
                        &action_identifier,
                        DEFAULT_ACTION_IDENTIFIER,
                        DISMISS_ACTION_IDENTIFIER,
                    );
                    let id = request.identifier().to_string();
                    for event in response_events(action) {
                        emit_event(event, &id);
                    }
                }

                completion_handler.call(());
            }
        }
    );

    pub fn initialize<R: Runtime>(app: &AppHandle<R>, node: &NodeHost) -> Result<(), String> {
        set_node_host(node)?;
        on_main_thread(app, || {
            let center = UNUserNotificationCenter::currentNotificationCenter();
            DELEGATE.with(|slot| {
                let mut slot = slot.borrow_mut();
                let delegate = slot.get_or_insert_with(|| unsafe {
                    let delegate: Retained<NotificationDelegate> =
                        msg_send![NotificationDelegate::class(), new];
                    delegate
                });
                center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
            });

            let category_identifier = NSString::from_str(DISMISS_CATEGORY_IDENTIFIER);
            let actions = NSArray::<UNNotificationAction>::new();
            let intent_identifiers = NSArray::<NSString>::new();
            let category =
                UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                    &category_identifier,
                    &actions,
                    &intent_identifiers,
                    UNNotificationCategoryOptions::CustomDismissAction,
                );
            let categories = NSSet::from_retained_slice(&[category]);
            center.setNotificationCategories(&categories);
            Ok(())
        })
    }

    pub fn show<R: Runtime>(
        app: &AppHandle<R>,
        node: &NodeHost,
        params: &Value,
    ) -> Result<Value, String> {
        let options = parse_notification_options(params)?;
        if MainThreadMarker::new().is_some() {
            return Err("notification.show cannot block the application main thread".into());
        }

        initialize(app, node)?;

        let id = next_notification_id();
        let (sender, receiver) = mpsc::sync_channel(1);
        let app_for_authorization = app.clone();
        let id_for_authorization = id.clone();
        let options_for_authorization = options.clone();
        let request_result_sender = sender.clone();

        app.run_on_main_thread(move || {
            let center = UNUserNotificationCenter::currentNotificationCenter();
            let authorization_options = if options_for_authorization.silent {
                UNAuthorizationOptions::Alert
            } else {
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound
            };
            let app_for_callback = app_for_authorization.clone();
            let authorization_sender = sender;
            let authorization =
                RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
                    if !error.is_null() {
                        let _ = authorization_sender.send(Err(error_description(error)));
                        return;
                    }
                    if !granted.as_bool() {
                        let _ = authorization_sender
                            .send(Err("notification permission was denied".into()));
                        return;
                    }

                    let request_sender = request_result_sender.clone();
                    let request_id = id_for_authorization.clone();
                    let request_options = options_for_authorization.clone();
                    if let Err(error) = app_for_callback.run_on_main_thread(move || {
                        add_notification(request_id, request_options, request_sender);
                    }) {
                        let _ = request_result_sender.send(Err(format!(
                            "failed to schedule native notification: {error}"
                        )));
                    }
                });
            center.requestAuthorizationWithOptions_completionHandler(
                authorization_options,
                &authorization,
            );
        })
        .map_err(|error| format!("failed to request notification permission: {error}"))?;

        receiver
            .recv()
            .map_err(|_| "notification authorization callback was interrupted".to_string())?
    }

    pub fn close<R: Runtime>(
        app: &AppHandle<R>,
        node: &NodeHost,
        params: &Value,
    ) -> Result<Value, String> {
        set_node_host(node)?;
        let id = parse_notification_id(params)?;
        on_main_thread(app, move || {
            let center = UNUserNotificationCenter::currentNotificationCenter();
            let identifier = NSString::from_str(&id);
            let identifiers = NSArray::from_slice(&[&*identifier]);
            center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
            center.removeDeliveredNotificationsWithIdentifiers(&identifiers);
            emit_event_result("notification:closed", &id)?;
            Ok(Value::Null)
        })
    }

    fn add_notification(
        id: String,
        options: NotificationOptions,
        sender: mpsc::SyncSender<Result<Value, String>>,
    ) {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let content = UNMutableNotificationContent::new();
        let title = NSString::from_str(&options.title);
        let body = NSString::from_str(&options.body);
        content.setTitle(&title);
        content.setBody(&body);
        if let Some(subtitle) = options.subtitle {
            let subtitle = NSString::from_str(&subtitle);
            content.setSubtitle(&subtitle);
        }
        let category_identifier = NSString::from_str(DISMISS_CATEGORY_IDENTIFIER);
        content.setCategoryIdentifier(&category_identifier);
        if options.silent {
            content.setSound(None);
        } else {
            let sound = UNNotificationSound::defaultSound();
            content.setSound(Some(&sound));
        }

        let identifier = NSString::from_str(&id);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            None,
        );
        let completion = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(json!({"id": id}))
            } else {
                Err(error_description(error))
            };
            let _ = sender.send(result);
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&completion));
    }

    fn error_description(error: *mut NSError) -> String {
        if error.is_null() {
            return "native notification request failed".into();
        }
        let description = unsafe { error.as_ref() }
            .map(|error| error.localizedDescription().to_string())
            .unwrap_or_else(|| "native notification request failed".into());
        format!("native notification request failed: {description}")
    }

    fn set_node_host(node: &NodeHost) -> Result<(), String> {
        let slot = NODE_HOST.get_or_init(|| Mutex::new(None));
        *slot
            .lock()
            .map_err(|_| "notification NodeHost state was poisoned".to_string())? =
            Some(node.clone());
        Ok(())
    }

    fn emit_event(name: &str, id: &str) {
        if let Err(error) = emit_event_result(name, id) {
            eprintln!("[notifications] failed to deliver {name}: {error}");
        }
    }

    fn emit_event_result(name: &str, id: &str) -> Result<(), String> {
        let node = NODE_HOST
            .get()
            .and_then(|slot| slot.lock().ok()?.as_ref().cloned())
            .ok_or_else(|| "notification NodeHost is not initialized".to_string())?;
        node.send_event(name, json!({"id": id}), None)
    }

    fn on_main_thread<R: Runtime, T: Send + 'static>(
        app: &AppHandle<R>,
        action: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        if MainThreadMarker::new().is_some() {
            return action();
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.send(action());
        })
        .map_err(|error| format!("failed to schedule native notification action: {error}"))?;
        receiver
            .recv()
            .map_err(|_| "native notification action was interrupted".to_string())?
    }
}

#[cfg(target_os = "macos")]
pub use macos::{close, initialize, show};

#[cfg(not(target_os = "macos"))]
pub fn initialize<R: Runtime>(_app: &AppHandle<R>, _node: &NodeHost) -> Result<(), String> {
    Err("native notification lifecycle is only supported on macOS".into())
}

#[cfg(not(target_os = "macos"))]
pub fn show<R: Runtime>(
    _app: &AppHandle<R>,
    _node: &NodeHost,
    params: &Value,
) -> Result<Value, String> {
    parse_notification_options(params)?;
    Err("native notification lifecycle is only supported on macOS".into())
}

#[cfg(not(target_os = "macos"))]
pub fn close<R: Runtime>(
    _app: &AppHandle<R>,
    _node: &NodeHost,
    params: &Value,
) -> Result<Value, String> {
    parse_notification_id(params)?;
    Err("native notification lifecycle is only supported on macOS".into())
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_ACTION_IDENTIFIER, DISMISS_ACTION_IDENTIFIER, ResponseAction, notification_id,
        parse_notification_id, parse_notification_options, response_action, response_events,
    };
    use serde_json::json;

    #[test]
    fn parses_required_notification_fields_and_optional_subtitle() {
        let options = parse_notification_options(&json!({
            "title": "Agent complete",
            "body": "The task finished",
            "silent": true,
            "subtitle": "Workspace"
        }))
        .expect("valid notification options");

        assert_eq!(options.title, "Agent complete");
        assert_eq!(options.subtitle.as_deref(), Some("Workspace"));
        assert_eq!(options.body, "The task finished");
        assert!(options.silent);

        let without_subtitle = parse_notification_options(&json!({
            "title": "Agent complete",
            "body": "The task finished",
            "silent": false
        }))
        .expect("valid notification options without subtitle");
        assert_eq!(without_subtitle.subtitle, None);
        assert!(!without_subtitle.silent);
    }

    #[test]
    fn rejects_malformed_notification_options() {
        for params in [
            json!(null),
            json!({"body": "body", "silent": true}),
            json!({"title": "title", "silent": true}),
            json!({"title": "", "body": "body", "silent": true}),
            json!({"title": "title", "body": "body"}),
            json!({"title": "title", "body": "body", "silent": true, "subtitle": null}),
        ] {
            assert!(parse_notification_options(&params).is_err(), "{params}");
        }
    }

    #[test]
    fn notification_ids_are_unique_for_process_counter_pairs() {
        let first = notification_id(41, 0);
        let second = notification_id(41, 1);
        let other_process = notification_id(42, 0);

        assert_eq!(first, "superset.native.41.0");
        assert_ne!(first, second);
        assert_ne!(first, other_process);
    }

    #[test]
    fn close_requires_a_non_empty_notification_id() {
        assert_eq!(
            parse_notification_id(&json!({"id": "notification-1"})).as_deref(),
            Ok("notification-1")
        );
        assert!(parse_notification_id(&json!({})).is_err());
        assert!(parse_notification_id(&json!({"id": ""})).is_err());
        assert!(parse_notification_id(&json!({"id": 1})).is_err());
    }

    #[test]
    fn native_default_action_clicks_and_dismissal_closes() {
        assert_eq!(
            response_action(
                DEFAULT_ACTION_IDENTIFIER,
                DEFAULT_ACTION_IDENTIFIER,
                DISMISS_ACTION_IDENTIFIER,
            ),
            ResponseAction::Click
        );
        assert_eq!(
            response_action(
                DISMISS_ACTION_IDENTIFIER,
                DEFAULT_ACTION_IDENTIFIER,
                DISMISS_ACTION_IDENTIFIER,
            ),
            ResponseAction::Dismiss
        );
        assert_eq!(
            response_action(
                "custom.action",
                DEFAULT_ACTION_IDENTIFIER,
                DISMISS_ACTION_IDENTIFIER,
            ),
            ResponseAction::Other
        );
        assert_eq!(
            response_events(ResponseAction::Click),
            ["notification:click", "notification:closed"]
        );
        assert_eq!(
            response_events(ResponseAction::Dismiss),
            ["notification:closed"]
        );
        assert!(response_events(ResponseAction::Other).is_empty());
    }
}
