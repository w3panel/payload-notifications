/** Scoped styles for the visual email designer (uses Payload admin theme variables). */
export const STUDIO_CSS = `
.pn-studio{--pn-border:var(--theme-elevation-150,#ddd);--pn-muted:var(--theme-elevation-500,#71717a);--pn-accent:var(--theme-success-500,#2563eb);display:grid;gap:.75rem;font-size:13px;container-type:inline-size}
.pn-studio button{cursor:pointer;padding:4px 8px;border:1px solid var(--pn-border);border-radius:4px;background:var(--theme-elevation-0,#fff);color:inherit;font:inherit}
.pn-studio button:disabled{opacity:.5;cursor:default}
.pn-studio button.pn-active{border-color:var(--pn-accent);box-shadow:inset 0 0 0 1px var(--pn-accent)}
.pn-studio input,.pn-studio select,.pn-studio textarea{font:inherit;padding:4px 6px;border:1px solid var(--pn-border);border-radius:4px;background:var(--theme-input-bg,var(--theme-elevation-0,#fff));color:inherit;width:100%;box-sizing:border-box}
.pn-studio input[type=checkbox]{width:auto}.pn-studio input[type=color]{width:36px;padding:0;height:28px}
.pn-toolbar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
.pn-designer{display:grid;grid-template-columns:1fr;gap:.75rem;align-items:start}
.pn-palette{display:flex;flex-wrap:wrap;gap:4px}
.pn-palette .pn-panel-title{flex-basis:100%}
@container (min-width:640px){.pn-designer{grid-template-columns:minmax(0,1fr) 260px}.pn-palette{grid-column:1/-1}}
@container (min-width:1000px){.pn-designer{grid-template-columns:140px minmax(0,1fr) 280px}.pn-palette{grid-column:auto;display:grid}}
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
.pn-email-meta{display:grid;gap:2px;font-size:13px}
.pn-preview-frame{border:1px solid var(--pn-border);border-radius:6px;background:#fff;display:block;margin:0 auto;max-width:100%}
.pn-tabs{display:flex;gap:4px;flex-wrap:wrap}
.pn-checks{margin:0;padding-left:16px;font-size:12px}
.pn-checks .pn-error{color:#b91c1c}.pn-checks .pn-warning{color:#b45309}
.pn-channel-grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.pn-channel-result{display:grid;gap:6px;min-width:0}
.pn-channel{display:grid;gap:6px;justify-items:start}
.pn-phone{width:300px;border-radius:28px;border:8px solid #18181b;background:#18181b;overflow:hidden}
.pn-phone-bar{color:#fff;font-size:12px;text-align:center;padding:4px 0 6px}
.pn-phone-screen{min-height:260px;padding:12px;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.pn-phone-sms .pn-phone-screen{background:#f4f4f5}
.pn-phone-whatsapp .pn-phone-screen{background:#efeae2}
.pn-bubble{max-width:85%;padding:8px 10px;border-radius:14px;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.4;color:#18181b}
.pn-bubble-sms{background:#e4e4e7;border-bottom-left-radius:4px}
.pn-bubble-whatsapp{background:#fff;border-top-left-radius:4px;box-shadow:0 1px 1px rgba(0,0,0,.1)}
.pn-hsm-params{margin:4px 0 0;padding:0;list-style:none}
.pn-warning-text{color:#b45309}
.pn-inapp-card{display:flex;gap:10px;width:340px;padding:12px;border:1px solid var(--pn-border);border-radius:10px;background:var(--theme-elevation-0,#fff);box-shadow:0 2px 8px rgba(0,0,0,.08)}
.pn-inapp-icon{flex:0 0 36px;height:36px;border-radius:50%;background:#e0e7ff;display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden}
.pn-inapp-icon img{width:100%;height:100%;object-fit:cover}
.pn-inapp-body{display:grid;gap:2px;min-width:0}
.pn-inapp-title{font-weight:600;display:flex;gap:6px;align-items:center}
.pn-inapp-action{font-size:12px;color:#2563eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pn-badge{font-size:10px;padding:0 6px;border-radius:8px;background:#e4e4e7;font-weight:500;text-transform:uppercase}
.pn-badge-high,.pn-badge-urgent{background:#fee2e2;color:#b91c1c}
.pn-badge-low{background:#f4f4f5;color:#71717a}
.pn-versions{border-collapse:collapse;font-size:12px;width:100%}
.pn-versions th,.pn-versions td{text-align:left;padding:3px 6px;border-bottom:1px solid var(--pn-border)}
.pn-compare-frames{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pn-compare-frames figure{margin:0;display:grid;gap:4px}
.pn-compare-frames iframe{width:100%;height:480px}
.pn-diff{display:grid;gap:6px}
.pn-diff summary{cursor:pointer;font-weight:600}
.pn-diff-lines{margin:4px 0 0;font-size:11px;max-height:360px;overflow:auto;background:var(--theme-elevation-50,#fafafa);padding:6px;white-space:pre-wrap;word-break:break-all}
.pn-diff-added{background:#dcfce7;color:#166534}
.pn-diff-removed{background:#fee2e2;color:#991b1b}
.pn-diff-gap{color:#a1a1aa;font-style:italic}
.pn-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.pn-tile{padding:10px 12px;border:1px solid var(--pn-border);border-radius:8px}
.pn-tile-value{font-size:22px;font-weight:600}
.pn-tile-bad{border-color:#fca5a5;background:color-mix(in srgb,#fee2e2 50%,transparent)}
.pn-tile-warn{border-color:#fcd34d}
.pn-chart{display:flex;align-items:flex-end;gap:4px;height:140px;padding:4px 0}
.pn-chart-col{flex:1;display:flex;flex-direction:column;align-items:stretch;height:100%;justify-content:flex-end;min-width:6px}
.pn-chart-bar{display:flex;flex-direction:column-reverse;border-radius:3px 3px 0 0;overflow:hidden;min-height:2px}
.pn-chart-label{font-size:10px;color:var(--pn-muted);text-align:center;white-space:nowrap;overflow:hidden}
.pn-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px}
.pn-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle}
.pn-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.pn-list-plain{margin:0;padding-left:16px;font-size:13px}
.pn-dashboard{margin-bottom:24px}
.pn-settings th{width:240px;font-weight:500;color:var(--pn-muted);vertical-align:top}
.pn-error{color:#b91c1c}
`
