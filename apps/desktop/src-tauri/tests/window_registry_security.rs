use std::path::PathBuf;
use superset_desktop_native::window_registry::WindowRegistry;
use url::Url;

#[test]
fn packaged_renderer_does_not_trust_local_servers_or_similar_hosts() {
    let registry = WindowRegistry::new(PathBuf::new(), None);
    for address in [
        "https://tauri.localhost/index.html",
        "http://tauri.localhost/index.html",
        "tauri://localhost/index.html",
    ] {
        assert!(
            registry.is_app_url(&Url::parse(address).unwrap()),
            "{address}"
        );
    }
    for address in [
        "http://127.0.0.1:5173/",
        "http://localhost:5173/",
        "http://[::1]:5173/",
        "https://tauri.localhost:5173/",
        "https://tauri.localhost.example.com/",
        "https://tauri.localhost@evil.example/",
        "https://example.com/",
        "tauri://remote/index.html",
        "file:///tmp/index.html",
        "about:blank",
    ] {
        assert!(
            !registry.is_app_url(&Url::parse(address).unwrap()),
            "{address}"
        );
    }
}

#[test]
fn development_trust_is_bound_to_the_configured_loopback_port() {
    let registry = WindowRegistry::new(PathBuf::new(), Some(3145));
    for address in ["http://127.0.0.1:3145/", "http://[::1]:3145/"] {
        assert!(
            registry.is_app_url(&Url::parse(address).unwrap()),
            "{address}"
        );
    }
    for address in [
        "http://127.0.0.1:3146/",
        "http://127.0.0.1/",
        "http://[::1]:3146/",
        "http://127.0.0.1.example.com:3145/",
        "http://192.168.1.1:3145/",
    ] {
        assert!(
            !registry.is_app_url(&Url::parse(address).unwrap()),
            "{address}"
        );
    }
}
