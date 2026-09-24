use serde_json::{Value, json};
use std::io::BufReader;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use superset_desktop_native::sidecar::{read_frame, write_frame};

struct Fixture {
    child: Child,
    directory: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn exchanges_real_node_frames_and_preserves_window_scoped_trpc() {
    let desktop = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("superset-stdio-{}-{stamp}", std::process::id()));
    std::fs::create_dir(&directory).unwrap();
    let script = directory.join("fixture.mjs");
    let build = Command::new("bun")
        .current_dir(&desktop)
        .args([
            "build",
            "src/main/native/stdio-peer/fixtures/native-host.ts",
            "--target=node",
            "--outfile",
        ])
        .arg(&script)
        .output()
        .expect("Bun is required for the native integration test");
    assert!(
        build.status.success(),
        "{}",
        String::from_utf8_lossy(&build.stderr)
    );
    let child = Command::new("node")
        .arg(script)
        .env_remove("NODE_OPTIONS")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("Node is required for the native integration test");
    let mut fixture = Fixture { child, directory };
    let stdout = fixture.child.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::with_capacity(7, stdout);
        loop {
            match read_frame(&mut reader) {
                Ok(Some(frame)) => {
                    if sender.send(Ok(frame)).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = sender.send(Err(error));
                    break;
                }
            }
        }
    });
    let receive = || {
        receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("Node response timed out")
            .expect("invalid Node frame")
    };
    assert_eq!(
        receive(),
        json!({"type":"event","name":"ready","payload":{"protocol":1}})
    );
    let stdin = fixture.child.stdin.as_mut().unwrap();
    write_frame(
        stdin,
        &json!({"type":"request","id":"slow","method":"slow","params":"ação\n🎉"}),
    )
    .unwrap();
    write_frame(
        stdin,
        &json!({"type":"request","id":"fast","method":"echo","params":{"ok":true}}),
    )
    .unwrap();
    assert_eq!(
        receive(),
        json!({"type":"response","id":"fast","value":{"ok":true}})
    );
    assert_eq!(
        receive(),
        json!({"type":"response","id":"slow","value":"ação\n🎉"})
    );
    write_frame(stdin, &json!({
        "type":"request","id":"invoke","method":"trpc","windowLabel":"window-fixture",
        "params":{"method":"request","operation":{"id":"query","type":"query","path":"context","input":{"json":null,"meta":{"values":["undefined"],"v":1}}}}
    })).unwrap();
    let replies = [receive(), receive()];
    assert!(replies.contains(&json!({"type":"response","id":"invoke","value":null})));
    let event: &Value = replies
        .iter()
        .find(|value| value["type"] == "event")
        .expect("missing RPC result");
    assert_eq!(event["windowLabel"], "window-fixture");
    assert_eq!(event["name"], "trpc:response");
    assert_eq!(event["payload"]["id"], "query");
    assert_eq!(
        event["payload"]["result"]["data"]["json"]["windowLabel"],
        "window-fixture"
    );
    assert_eq!(
        event["payload"]["result"]["data"]["meta"]["values"]["date"],
        json!(["Date"])
    );
    fixture.child.stdin.take();
    assert!(receiver.recv_timeout(Duration::from_secs(10)).is_err());
    assert!(fixture.child.wait().unwrap().success());
    reader.join().unwrap();
}
