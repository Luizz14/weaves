use tauri_runtime_cef::cef::WindowOpenDisposition;
use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum OpenTarget {
    Popup,
    Pane,
    DeepLink,
    Deny,
}

pub fn classify_open(
    url: &Url,
    disposition: WindowOpenDisposition,
    deep_link_schemes: &[String],
) -> OpenTarget {
    if deep_link_schemes
        .iter()
        .any(|scheme| scheme == url.scheme())
    {
        return OpenTarget::DeepLink;
    }
    if !is_guest_url(url) {
        return OpenTarget::Deny;
    }
    if disposition == WindowOpenDisposition::NEW_POPUP
        || disposition == WindowOpenDisposition::NEW_WINDOW
        || url.scheme() == "about"
        || is_oauth_authorization(url)
    {
        return OpenTarget::Popup;
    }
    OpenTarget::Pane
}

pub fn is_guest_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about")
}

fn is_oauth_authorization(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let first = |key: &str| {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    };
    if !first("client_id").is_some_and(|value| !value.trim().is_empty())
        || !first("redirect_uri").is_some_and(|value| !value.trim().is_empty())
    {
        return false;
    }
    let Some(response_type) = first("response_type") else {
        return false;
    };
    let mut values: Vec<&str> = response_type.split_whitespace().collect();
    values.sort_unstable();
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        return false;
    }
    matches!(
        values.join(" ").as_str(),
        "code"
            | "id_token"
            | "none"
            | "token"
            | "code id_token"
            | "code token"
            | "id_token token"
            | "code id_token token"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(url: &str, disposition: WindowOpenDisposition) -> OpenTarget {
        classify_open(&Url::parse(url).unwrap(), disposition, &["superset".into()])
    }

    #[test]
    fn distinguishes_native_popups_from_links_without_using_geometry() {
        assert_eq!(
            classify("https://example.com", WindowOpenDisposition::NEW_POPUP),
            OpenTarget::Popup
        );
        assert_eq!(
            classify("https://example.com", WindowOpenDisposition::NEW_WINDOW),
            OpenTarget::Popup
        );
        assert_eq!(
            classify(
                "https://example.com",
                WindowOpenDisposition::NEW_FOREGROUND_TAB
            ),
            OpenTarget::Pane
        );
        assert_eq!(
            classify(
                "https://example.com",
                WindowOpenDisposition::NEW_BACKGROUND_TAB
            ),
            OpenTarget::Pane
        );
    }

    #[test]
    fn keeps_blank_and_authorization_windows_attached_to_the_opener() {
        for url in ["about:blank", "about:blank#state", "about:srcdoc"] {
            assert_eq!(
                classify(url, WindowOpenDisposition::NEW_FOREGROUND_TAB),
                OpenTarget::Popup
            );
        }
        for response in [
            "code",
            "token",
            "id_token",
            "none",
            "token%20code%20id_token",
        ] {
            let url = format!(
                "https://idp.example/authorize?client_id=a&redirect_uri=b&response_type={response}"
            );
            assert_eq!(
                classify(&url, WindowOpenDisposition::NEW_FOREGROUND_TAB),
                OpenTarget::Popup
            );
        }
    }

    #[test]
    fn does_not_mistake_invalid_oauth_parameters_for_an_authorization_request() {
        for query in [
            "client_id=&redirect_uri=b&response_type=code",
            "client_id=a&redirect_uri=%20&response_type=code",
            "client_id=a&redirect_uri=b&response_type=code%20code",
            "client_id=a&redirect_uri=b&response_type=code%20unknown",
            "client_id=a&redirect_uri=b",
            "client_id=&client_id=a&redirect_uri=b&response_type=code",
        ] {
            assert_eq!(
                classify(
                    &format!("https://idp.example/?{query}"),
                    WindowOpenDisposition::NEW_FOREGROUND_TAB
                ),
                OpenTarget::Pane
            );
        }
    }

    #[test]
    fn blocks_local_files_and_handles_registered_deep_links_separately() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "chrome://settings",
            "data:text/html,hello",
        ] {
            assert_eq!(
                classify(url, WindowOpenDisposition::NEW_POPUP),
                OpenTarget::Deny
            );
        }
        assert_eq!(
            classify(
                "superset://workspace/example",
                WindowOpenDisposition::NEW_POPUP
            ),
            OpenTarget::DeepLink
        );
    }
}
