import { useRef, useCallback } from 'react';

const MAX_HISTORY = 50;

export function useUndo(setItems, scheduleSave, isAdmin) {
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const lastSnapshot = useRef(null);

  const pushUndo = useCallback((prevItems) => {
    undoStack.current.push(prevItems);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const setItemsWithUndo = useCallback((updater) => {
    setItems(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Only push if the reference actually changed
      if (next !== prev) pushUndo(prev);
      return next;
    });
    if (isAdmin) scheduleSave();
  }, [setItems, pushUndo, isAdmin, scheduleSave]);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    setItems(prev => {
      redoStack.current.push(prev);
      return undoStack.current.pop();
    });
    if (isAdmin) scheduleSave();
  }, [setItems, isAdmin, scheduleSave]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    setItems(prev => {
      undoStack.current.push(prev);
      return redoStack.current.pop();
    });
    if (isAdmin) scheduleSave();
  }, [setItems, isAdmin, scheduleSave]);

  const canUndo = () => undoStack.current.length > 0;
  const canRedo = () => redoStack.current.length > 0;

  return { setItemsWithUndo, undo, redo, canUndo, canRedo, pushUndo };
}
