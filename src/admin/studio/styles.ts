/** Scoped styles for the visual email designer (uses Payload admin theme variables). */
export const STUDIO_CSS = `
.pn-studio{--pn-border:var(--theme-elevation-150,#ddd);--pn-muted:var(--theme-elevation-500,#71717a);--pn-accent:var(--theme-success-500,#2563eb);display:grid;gap:.75rem;font-size:13px}
.pn-studio button{cursor:pointer;padding:4px 8px;border:1px solid var(--pn-border);border-radius:4px;background:var(--theme-elevation-0,#fff);color:inherit;font:inherit}
.pn-studio button:disabled{opacity:.5;cursor:default}
.pn-studio button.pn-active{border-color:var(--pn-accent);box-shadow:inset 0 0 0 1px var(--pn-accent)}
.pn-studio input,.pn-studio select,.pn-studio textarea{font:inherit;padding:4px 6px;border:1px solid var(--pn-border);border-radius:4px;background:var(--theme-input-bg,var(--theme-elevation-0,#fff));color:inherit;width:100%;box-sizing:border-box}
.pn-studio input[type=checkbox]{width:auto}.pn-studio input[type=color]{width:36px;padding:0;height:28px}
.pn-toolbar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
.pn-designer{display:grid;grid-template-columns:150px minmax(0,1fr) 280px;gap:.75rem;align-items:start}
@media (max-width:1100px){.pn-designer{grid-template-columns:1fr}}
.pn-palette{display:grid;gap:4px}
.pn-palette button{text-align:left}
.pn-panel-title{font-weight:600;margin-bottom:4px}
.pn-canvas{padding:16px;border:1px solid var(--pn-border);border-radius:6px;min-height:240px;overflow:auto}
.pn-canvas-body{margin:0 auto;padding:8px;color:#18181b;font-family:Arial,sans-serif;font-size:15px;line-height:1.5}
.pn-list{display:grid}
.pn-drop{height:6px;border-radius:3px;transition:background .1s}
.pn-drop-over{height:14px;background:color-mix(in srgb,var(--pn-accent) 40%,transparent)}
.pn-drop-empty{height:auto;padding:12px;text-align:center;color:#a1a1aa;border:1px dashed #d4d4d8}
.pn-block{position:relative;padding:8px;border:1px dashed transparent;border-radius:4px;outline:none}
.pn-block:hover,.pn-block:focus-visible{border-color:#a1a1aa}
.pn-block-selected{border:1px solid var(--pn-accent)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--pn-accent) 25%,transparent)}
.pn-block-problem{border-color:#dc2626}
.pn-block-tag{position:absolute;top:-9px;left:6px;font-size:10px;padding:0 4px;background:#fff;color:#71717a;border-radius:3px;display:none}
.pn-block:hover>.pn-block-tag,.pn-block-selected>.pn-block-tag,.pn-block-problem>.pn-block-tag{display:block}
.pn-block-problem>.pn-block-tag{color:#dc2626}
.pn-block a{pointer-events:none}
.pn-columns{display:flex;gap:8px}.pn-column{flex:1 1 0;min-width:0}
.pn-logic{border-left:3px solid #a855f7;padding-left:8px}
.pn-logic-label{font-size:11px;color:#7e22ce;margin:2px 0}
.pn-placeholder{padding:16px;text-align:center;background:#f4f4f5;color:#71717a;border-radius:4px}
.pn-button-preview{display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;font-weight:600}
.pn-footer-preview{font-size:12px;color:#71717a}
.pn-code-preview{margin:0;font-size:11px;white-space:pre-wrap;background:#f4f4f5;padding:6px}
.pn-var{display:inline-block;padding:0 4px;border-radius:3px;background:#e0e7ff;color:#3730a3;font-family:ui-monospace,Menlo,monospace;font-size:.85em}
.pn-var-unknown{background:#fee2e2;color:#b91c1c;text-decoration:wavy underline}
.pn-properties{display:grid;gap:8px;padding:8px;border:1px solid var(--pn-border);border-radius:6px}
.pn-field{display:grid;gap:2px}.pn-label{font-size:11px;color:var(--pn-muted)}
.pn-check{display:flex;gap:6px;align-items:center}
.pn-color{display:flex;gap:4px;align-items:center}
.pn-row{display:flex;flex-wrap:wrap;gap:4px;align-items:end}
.pn-actions{margin-top:4px}
.pn-danger{color:#b91c1c}
.pn-hint{margin:0;font-size:11px;color:var(--pn-muted)}
.pn-problems{margin:0;padding-left:16px;color:#b91c1c;font-size:12px}
.pn-inline-editor{display:grid;gap:2px}
.pn-inline-toolbar{display:flex;gap:4px;align-items:center}
.pn-inline-toolbar select{width:auto;max-width:180px}
.pn-mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.pn-autocomplete{position:relative}
.pn-suggestions{position:absolute;z-index:10;left:0;right:0;max-height:180px;overflow:auto;margin:2px 0 0;padding:0;list-style:none;background:var(--theme-elevation-0,#fff);border:1px solid var(--pn-border);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.12)}
.pn-suggestions li{padding:3px 6px;cursor:pointer;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.pn-suggestions li[aria-selected=true]{background:#e0e7ff}
.pn-preview-frame{border:1px solid var(--pn-border);border-radius:6px;background:#fff;display:block;margin:0 auto;max-width:100%}
.pn-tabs{display:flex;gap:4px;flex-wrap:wrap}
.pn-checks{margin:0;padding-left:16px;font-size:12px}
.pn-checks .pn-error{color:#b91c1c}.pn-checks .pn-warning{color:#b45309}
`
