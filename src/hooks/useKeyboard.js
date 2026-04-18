import { useEffect } from 'react';
import { uid, isTyping } from '../utils.js';

export function useKeyboard({
  isAdmin, selectedIds, setSelectedIds, clipboard, setClipboard,
  items, setItemsAndSave, editingTextId, setEditingTextId,
  viewCenter, setShiftHeld, undo, redo,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Shift") setShiftHeld(true);
      if (!isAdmin) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (editingTextId || isTyping()) return;
        if (selectedIds.length > 0) {
          setItemsAndSave(p => p.filter(i => !selectedIds.includes(i.id)));
          setSelectedIds([]);
        }
      }

      if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
        if (editingTextId || isTyping()) return;
        const toCopy = items.filter(i => selectedIds.includes(i.id));
        setClipboard(toCopy.map(i => ({ ...i, id: uid() })));
        // Write a marker to the system clipboard so a stale PC image doesn't
        // paste unexpectedly — paste handler checks for image files first.
        navigator.clipboard?.writeText("__board_clipboard__").catch(() => {});
        e.preventDefault();
      }

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (editingTextId || isTyping()) return;
        undo();
        e.preventDefault();
      }

      if ((e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === "y" && (e.ctrlKey || e.metaKey))) {
        if (editingTextId || isTyping()) return;
        redo();
        e.preventDefault();
      }

      if (e.key === "Escape") {
        setSelectedIds([]);
        setEditingTextId(null);
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === "Shift") setShiftHeld(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isAdmin, selectedIds, clipboard, items, editingTextId,
      setShiftHeld, setSelectedIds, setClipboard, setItemsAndSave, setEditingTextId, undo, redo]);
}
