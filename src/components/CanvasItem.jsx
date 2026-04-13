import { ConnectorHandles } from './ConnectorHandles.jsx';
import { ItemHandles } from './ItemHandles.jsx';
import { Z } from '../styles.js';
import { TEXT_PAD_X, TEXT_PAD_Y, TEXT_LINE_HEIGHT, TEXT_DEFAULT_SIZE, FONT } from '../constants.js';


export function CanvasItem({ item, selectedIds, isAdmin, editingTextId, updateItem, setEditingTextId }) {
  const isSel = selectedIds.includes(item.id) && isAdmin;

  if (!isSel) return null;

  // Connector type — delegate to specialized handle component
  if (item.type === "connector") {
    return <ConnectorHandles item={item} />;
  }

  // Render handles for non-connector items
  const isEd = editingTextId === item.id && (item.type === "text" || item.type === "link");
  const fs = item.fontSize || TEXT_DEFAULT_SIZE;

  return (
    <>
      {isEd && (
        <textarea data-ui autoFocus value={item.text}
          onFocus={() => { if (item.placeholder) updateItem(item.id, { text: "", placeholder: false }); }}
          onChange={e => updateItem(item.id, { text: e.target.value })}
          onBlur={() => setEditingTextId(null)}
          onPointerDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          style={{
            position: "absolute", left: item.x, top: item.y, width: item.w, height: item.h,
            transform: `rotate(${item.rotation || 0}deg)`, transformOrigin: "center center",
            resize: "none", border: "none", outline: "none",
            overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word",
            pointerEvents: "auto", touchAction: "auto",
            lineHeight: `${fs * TEXT_LINE_HEIGHT}px`,
            padding: `${TEXT_PAD_Y}px ${TEXT_PAD_X}px`, boxSizing: "border-box",
            WebkitAppearance: "none", appearance: "none",
            background: "transparent",
            color: item.color, WebkitTextFillColor: item.color,
            fontSize: fs, fontFamily: item.fontFamily || FONT,
            fontWeight: item.bold ? "bold" : "normal", fontStyle: item.italic ? "italic" : "normal",
            textAlign: item.align || "left",
            zIndex: Z.HANDLE_INFO,
          }} />
      )}
      <ItemHandles item={item} />
    </>
  );
}
