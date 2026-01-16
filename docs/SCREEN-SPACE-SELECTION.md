# Screen-Space Train Selection

> **Note**: This document describes the original screen-space hit detection approach. It has been superseded by **Oriented Bounding Rectangle (OBR)** hit detection implemented in **009-obr-hit-detection**. See `apps/web/src/lib/map/MapboxRaycaster.ts` for the current implementation.

## Overview (Historical)

We replaced GPU-based picking with a purely screen-space approach so hover and click detection stay in sync with Mapbox rendering without maintaining a parallel camera/picking scene. The pointer logic now:

- Projects train coordinates into screen space with `map.project`.
- Computes the nearest train within a configurable pixel radius for hover/click.
- Highlights the hovered train by scaling its Three.js group slightly.
- Emits the existing `onRaycastResult` callback so downstream consumers (debug overlay, future state provider) behave exactly as before.

All 3D visuals still come from Mapbox's provided view/projection matrices; we only use screen-space math for interaction.

## Recent Fix (2025-10-30)

**Issue**: Original implementation mixed local and world coordinate systems - it added `boundingCenterOffset` (local mesh space) to `mesh.position` (world space), causing incorrect hit detection.

**Fix**:
- Use `mesh.position` directly (already in correct world space)
- Calculate radius from current mesh scale (accounts for highlight scaling)
- Project radius to screen space properly using world-space offset

## Implementation Notes

| Concern | Detail |
| --- | --- |
| Hover radius | Bounding radius projected to screen, with a minimum of `≈20px` (14 base + padding) to keep the glow stable. |
| Click radius | Same projected radius with a slightly tighter padding (`+4px`) for deliberate selection. |
| Highlight effect | `TrainMeshManager.setHighlightedTrain` scales the active mesh to `baseScale * 1.12` and restores the previous one. |
| Hit test geometry | Per-train bounding sphere (derived from `Box3.getBoundingSphere`) projected to screen each frame. |
| Missing trains | Hover ref is cleared if the underlying mesh disappears (e.g., train leaves the snapshot). |
| Debug callback | `onRaycastResult` is triggered with `objectsHit: 1` and matching metadata so existing tooling continues to work. |

## Debug Mode

Enable debug visualization by adding `?debug=true` to the URL:
- Red circles show clickable areas around each train
- Green circles indicate currently hovered train
- Yellow dots mark the exact center of each train's hit detection area
- Train IDs are displayed when hovering

Console logging shows:
- Hit detection calculations (distance vs threshold)
- Click events with vehicle key and route
- Screen coordinate projections

## QA Checklist

- [ ] Verify hover glow triggers and releases correctly across zoom levels (zoomed out lines vs. close-up stations).
- [ ] Check that clicking in dense areas (e.g., multiple trains on the same line) consistently selects the intended train.
- [ ] Confirm hover/click continue working after trains enter/leave the snapshot (re-polling).
- [ ] Ensure the highlight reset runs when the cursor leaves the map canvas.
- [ ] Confirm the debug overlay captures the same vehicle key as the log output.
- [x] Fix coordinate system mismatch in getScreenCandidates (2025-10-30)

## Future Enhancements

- Dynamically adjust hover/click thresholds based on zoom and/or device pixel ratio.  
- Add optional easing/animation when scaling highlight meshes.  
- Integrate selection with the forthcoming `TrainStateProvider` so the info panel opens immediately on click.
