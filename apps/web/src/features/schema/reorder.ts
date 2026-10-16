// Reordering a list by drag and drop, with buttons beside it for the
// keyboard and for touch screens, which have no native drag.

import { type DragEvent, useState } from 'react';

/** The list with the item at `from` moved to `to`; an unchanged copy when out of range. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const inRange = (index: number) => index >= 0 && index < list.length;
  if (from === to || !inRange(from) || !inRange(to)) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * Drag handlers for the items of a list: dropping one on another moves it
 * there. `dragging` is the index being dragged, for its style.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number>();
  const itemProps = (index: number) => ({
    draggable: true,
    'data-dragging': dragging === index ? '' : undefined,
    onDragStart: (event: DragEvent) => {
      setDragging(index);
      event.dataTransfer.effectAllowed = 'move';
      // Firefox starts a drag only when it carries some data.
      event.dataTransfer.setData('text/plain', String(index));
    },
    onDragOver: (event: DragEvent) => {
      if (dragging === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      if (dragging !== undefined) onMove(dragging, index);
      setDragging(undefined);
    },
    onDragEnd: () => setDragging(undefined),
  });
  return { dragging, itemProps };
}
