//! #158 — when may we disable WebKitGTK's DMABUF renderer?
//!
//! One decision, one function, one test surface. `main()` asks
//! [`dmabuf_renderer_decision`] and applies the answer; nothing else in the
//! app knows this workaround exists.
//!
//! The problem space, with hard edges:
//!
//! * **Why disable at all** — webkit2gtk 2.42's DMABUF renderer aborts at
//!   launch (`EGL_BAD_PARAMETER`) on some GPU / Mesa combinations before any
//!   window appears. The env var `WEBKIT_DISABLE_DMABUF_RENDERER=1` selects a
//!   working but unaccelerated GL path.
//! * **Why not always disable** — that fallback path loses hardware
//!   compositing / vsync, so scrolling stutters for every Linux user. Windows
//!   (WebView2) and macOS (WKWebView) never take this path; this is a
//!   Linux-only trade-off.
//! * **Why not never disable** — WebKitGTK 2.44 added its own EGL-display
//!   fallback, so on 2.44+ the crash cannot happen and DMABUF is strictly
//!   better. On < 2.44 the crash can happen and there is no in-WebKit
//!   fallback, so the env var is the only guard.
//!
//! The boundary is therefore a pure function of two inputs, in strict
//! priority order:
//!
//! 1. **The user's own value of the env variable wins, always.** If they set
//!    it to anything (including "0" or "1"), we never touch it.
//! 2. **webkit2gtk < 2.44 → disable** (the only runtimes that can abort).
//! 3. **Otherwise → leave DMABUF enabled** (hardware-accelerated scrolling).

/// What `main()` should do about `WEBKIT_DISABLE_DMABUF_RENDERER`.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum DmabufDecision {
    /// The user set the variable themselves; export nothing, override nothing.
    UserOwnsVariable,
    /// Old webkit2gtk: set the variable to "1" to avoid a launch abort.
    SetDisable,
    /// New webkit2gtk: do nothing; keep the accelerated renderer.
    KeepEnabled,
}

/// Pure decision function — both inputs are injected so the tests can pin
/// them instead of reading the real environment or linking WebKit.
pub fn dmabuf_renderer_decision(
    env_set: bool,
    webkit_version: (u32, u32),
) -> DmabufDecision {
    if env_set {
        return DmabufDecision::UserOwnsVariable;
    }
    if webkit_version < (2, 44) {
        return DmabufDecision::SetDisable;
    }
    DmabufDecision::KeepEnabled
}

/// Called once, before WebKit initialises.
#[cfg(target_os = "linux")]
pub fn apply_dmabuf_renderer_policy() {
    let decision = dmabuf_renderer_decision(
        std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some(),
        (webkit2gtk::major_version(), webkit2gtk::minor_version()),
    );
    if decision == DmabufDecision::SetDisable {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

#[cfg(not(target_os = "linux"))]
pub fn apply_dmabuf_renderer_policy() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_value_always_wins_even_zero() {
        // "0" explicitly re-enables DMABUF on a crashing runtime — that is the
        // user's escape hatch and we must not take it away from them.
        assert_eq!(
            dmabuf_renderer_decision(true, (2, 40)),
            DmabufDecision::UserOwnsVariable
        );
        assert_eq!(
            dmabuf_renderer_decision(true, (2, 46)),
            DmabufDecision::UserOwnsVariable
        );
    }

    #[test]
    fn disables_only_below_244() {
        assert_eq!(
            dmabuf_renderer_decision(false, (2, 42)),
            DmabufDecision::SetDisable
        );
        // 2.44 is the first release with the upstream EGL-display fallback.
        assert_eq!(
            dmabuf_renderer_decision(false, (2, 44)),
            DmabufDecision::KeepEnabled
        );
        assert_eq!(
            dmabuf_renderer_decision(false, (2, 46)),
            DmabufDecision::KeepEnabled
        );
    }

    #[test]
    fn version_comparison_is_componentwise() {
        // 3.x and 2.100 must not be misread as "older than 2.44".
        assert_eq!(
            dmabuf_renderer_decision(false, (3, 0)),
            DmabufDecision::KeepEnabled
        );
        assert_eq!(
            dmabuf_renderer_decision(false, (2, 100)),
            DmabufDecision::KeepEnabled
        );
    }
}
