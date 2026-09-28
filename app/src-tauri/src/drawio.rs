//! drawio.rs — offline diagrams.net support.
//!
//! The frontend (`DrawioPane.vue`) embeds the diagrams.net webapp in an
//! iframe. When the webapp has been vendored by `scripts/fetch-drawio.mjs`
//! (unpacked into `src-tauri/resources/drawio/`), we serve it through Tauri's
//! asset protocol for offline use; otherwise the frontend falls back to the
//! online `embed.diagrams.net` host.

use std::path::PathBuf;
use tauri::Manager;

/// Absolute path to the vendored webapp's `index.html`, or `None` when the
/// offline bundle is not present. The frontend turns the path into an
/// `asset://` URL via `convertFileSrc` and appends the embed query params.
#[tauri::command]
pub fn drawio_editor_path(app: tauri::AppHandle) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Packaged builds: `bundle.resources: ["resources/drawio"]` copies the
    // directory into the resource dir preserving its relative path.
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("resources").join("drawio").join("index.html"));
        candidates.push(res.join("drawio").join("index.html"));
    }

    // Dev builds: the repo working tree (src-tauri/../resources/drawio and
    // src-tauri/resources/drawio both resolve from CARGO_MANIFEST_DIR).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("resources").join("drawio").join("index.html"));
    candidates.push(manifest.join("..").join("resources").join("drawio").join("index.html"));

    for c in candidates {
        if c.is_file() {
            return Some(c.to_string_lossy().into_owned());
        }
    }
    None
}
