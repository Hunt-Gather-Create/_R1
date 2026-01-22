import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";

/**
 * Custom collision detection that prioritizes columns for cross-column drops.
 *
 * The default collision detection algorithms (closestCorners, etc.) can cause issues
 * where sortable items take precedence over droppable columns. This custom detection:
 *
 * 1. Uses pointer-based detection for precision
 * 2. When over items, returns them for sorting within a column
 * 3. When over empty column space, returns the column for cross-column drops
 * 4. Falls back to rect intersection for edge cases
 */
export const columnAwareCollisionDetection: CollisionDetection = (args) => {
  // First, check what's directly under the pointer
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    // Separate column and item collisions
    const columnCollision = pointerCollisions.find((collision) =>
      String(collision.id).startsWith("column-")
    );
    const itemCollisions = pointerCollisions.filter(
      (collision) => !String(collision.id).startsWith("column-")
    );

    // If we're over items, return them for positioning within the column
    if (itemCollisions.length > 0) {
      return itemCollisions;
    }

    // If only over a column (empty space), return the column
    if (columnCollision) {
      return [columnCollision];
    }
  }

  // Fallback to rect intersection for edge cases (e.g., rapid movement)
  return rectIntersection(args);
};
