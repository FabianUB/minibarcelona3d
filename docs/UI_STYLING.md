# UI Styling Analysis: Legend & Settings Components

**Last Updated**: 2025-10-24 (Updated: Component separation completed)
**Purpose**: Document current styling patterns across Legend and Settings components to identify inconsistencies and establish standardization targets.

---

## Overview

This document analyzes the styling of two primary UI components across mobile and desktop viewports:
- **Legend** (LegendSheet.tsx + LegendPanel.tsx)
- **Settings** (SettingsSheet.tsx + SettingsMenu.tsx)

Both components use a responsive pattern with separated mobile/desktop implementations:
- **Mobile (≤768px)**: Bottom sheet overlay (LegendSheet.tsx / SettingsSheet.tsx)
- **Desktop (>768px)**: Expandable card panel (LegendPanel.tsx / SettingsMenu.tsx)

### Component Structure

**Legend**:
- `LegendPanel.tsx` - Main orchestrator, renders mobile or desktop
- `LegendSheet.tsx` - Mobile-specific sheet component

**Settings**:
- `SettingsMenu.tsx` - Main orchestrator, renders mobile or desktop
- `SettingsSheet.tsx` - Mobile-specific sheet component

---

## 1. Mobile View Styling (Bottom Sheets)

### Legend Sheet (LegendSheet.tsx)

**Component**: `Sheet` from ShadCN UI

**Trigger Button**:
```tsx
<Button
  variant="secondary"
  size="lg"
  className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 shadow-lg"
>
  Lines ({items.length})
</Button>
```
- Position: Bottom center (`left-1/2 -translate-x-1/2`)
- Spacing: `bottom-4` (1rem from bottom)
- Size: `lg` (large button)
- Shadow: `shadow-lg`

**Sheet Content**:
```tsx
<SheetContent side="bottom" className="h-auto max-h-[80vh]">
  <SheetHeader>
    <SheetTitle>Rodalies Lines</SheetTitle>
  </SheetHeader>
  <Separator className="my-4" />
  <div className="pb-6 px-2">
    {/* Content grid */}
  </div>
</SheetContent>
```

**Spacing Breakdown**:
- Max height: `80vh`
- Title component: `SheetTitle` (default ShadCN styling)
- Separator margin: `my-4` (1rem top & bottom)
- Content container: `pb-6 px-2` (1.5rem bottom, 0.5rem horizontal)
- No description element

---

### Settings Sheet (SettingsSheet.tsx)

**Component**: `Sheet` from ShadCN UI (✅ Now separated into dedicated file)

**Trigger Button**:
```tsx
<Button
  variant="secondary"
  size="icon"
  className="fixed bottom-4 right-4 z-10 shadow-lg w-12 h-12"
>
  <Settings className="h-5 w-5" />
</Button>
```
- Position: Bottom right (`right-4`)
- Spacing: `bottom-4` (1rem from bottom)
- Size: `icon` with explicit `w-12 h-12` (3rem × 3rem)
- Shadow: `shadow-lg`

**Sheet Content**:
```tsx
<SheetContent side="bottom" className="h-auto max-h-[80vh]">
  <SheetHeader>
    <SheetTitle>Settings</SheetTitle>
  </SheetHeader>
  <Separator className="my-3" />
  <div className="pb-6 px-2">
    {/* Settings content */}
  </div>
</SheetContent>
```

**Spacing Breakdown**:
- Max height: `max-h-[80vh]` ✅ **STANDARDIZED**
- Title component: `SheetTitle` (default ShadCN styling)
- Description: None (intentionally omitted for cleaner mobile UI)
- Separator margin: `my-3` (0.75rem top & bottom) ✅ **STANDARDIZED**
- Content container: `pb-6 px-2` (1.5rem bottom, 0.5rem horizontal) ✅ **CONSISTENT**

---

## 2. Desktop View Styling (Expandable Cards)

### Legend Panel (LegendPanel.tsx)

**Component**: `Card` from ShadCN UI

**Collapsed Button**:
```tsx
<button
  className="fixed top-4 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10
             flex items-center justify-center hover:scale-105 transition-transform
             border border-border"
>
  {/* Train SVG icon */}
</button>
```
- Position: Top left (`top-4 left-4`)
- Size: `w-12 h-12` (3rem × 3rem)
- Shape: `rounded-full` (circular)
- Border: `border border-border`
- Hover: `hover:scale-105`

**Expanded Card**:
```tsx
<Card className="fixed top-4 left-4 w-64 shadow-lg z-10">
  <CardHeader className="pb-2">
    <CardTitle className="flex items-center justify-between text-sm">
      <span>Rodalies Lines</span>
      <div className="flex gap-1">
        {/* Clear button (conditional) */}
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
          Clear
        </Button>
        {/* Close button */}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          ✕
        </Button>
      </div>
    </CardTitle>
  </CardHeader>
  <CardContent className="pt-0 pb-3">
    {/* Legend content */}
  </CardContent>
</Card>
```

**Spacing Breakdown**:
- Position: `top-4 left-4` (1rem from top & left)
- Width: `w-64` (16rem)
- Header: Uses `CardHeader` component with `pb-2` (0.5rem bottom padding)
- Title: `text-sm` font size
- Title component: `CardTitle` wrapper
- Header bottom padding: `pb-2` (0.5rem) ⚠️
- Content top padding: `pt-0` (no top padding)
- Content bottom padding: `pb-3` (0.75rem)
- Close button: `h-6 w-6 p-0` (1.5rem × 1.5rem, no padding)

---

### Settings Panel (SettingsMenu.tsx)

**Component**: `Card` from ShadCN UI

**Collapsed Button**:
```tsx
<button
  className="fixed top-20 left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10
             flex items-center justify-center hover:scale-105 transition-transform
             border border-border"
>
  <Settings className="h-5 w-5 text-foreground" />
</button>
```
- Position: Below legend (`top-20 left-4`)
- Size: `w-12 h-12` (3rem × 3rem) ✅ **CONSISTENT**
- Shape: `rounded-full` (circular) ✅ **CONSISTENT**
- Border: `border border-border` ✅ **CONSISTENT**
- Hover: `hover:scale-105` ✅ **CONSISTENT**

**Expanded Card**:
```tsx
<Card className="fixed top-20 left-4 w-80 shadow-lg z-10">
  <CardContent className="pt-4 pb-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold text-sm">Settings</h3>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
        ✕
      </Button>
    </div>
    {/* Settings content */}
  </CardContent>
</Card>
```

**Spacing Breakdown**:
- Position: `top-20 left-4` (5rem from top, 1rem from left)
- Width: `w-80` (20rem) ⚠️ **INCONSISTENT** (Legend uses `w-64`)
- Header: **NO CardHeader** - uses `CardContent` only ⚠️ **INCONSISTENT**
- Title: `h3` with `text-sm font-semibold`
- Title wrapper: Plain `div` with `mb-3` (0.75rem bottom margin)
- Content top padding: `pt-4` (1rem) ⚠️ **INCONSISTENT**
- Content bottom padding: `pb-4` (1rem)
- Close button: `h-6 w-6 p-0` (1.5rem × 1.5rem, no padding) ✅ **CONSISTENT**

---

## 3. Trigger Button Positioning Summary

### Mobile Triggers

| Component | Position | Size | Variant |
|-----------|----------|------|---------|
| Legend | Bottom center (`left-1/2 -translate-x-1/2`) | `lg` button | `secondary` |
| Settings | Bottom right (`right-4`) | `icon` + `w-12 h-12` | `secondary` |

**Analysis**: Different positions and sizes are intentional for UX - Legend is primary action (centered), Settings is secondary (corner).

### Desktop Triggers

| Component | Position | Size | Shape | Hover Effect |
|-----------|----------|------|-------|--------------|
| Legend | `top-4 left-4` | `w-12 h-12` | Circular | `scale-105` |
| Settings | `top-20 left-4` | `w-12 h-12` | Circular | `scale-105` |

**Analysis**: Consistent sizing and effects. Vertical stacking is intentional (Settings below Legend).

---

## 4. Content Area Styling

### Grid Layout (Legend only)

```tsx
<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 gap-2">
  {/* Line badges */}
</div>
```

- Desktop: 3 columns
- Mobile (sm): 4 columns
- Gap: `gap-2` (0.5rem)

### Settings Content Layout

```tsx
<div className="space-y-4">
  {/* Settings items with vertical spacing */}
</div>
```

- Vertical spacing: `space-y-4` (1rem between items)

---

## 5. Typography & Text Sizing

### Titles

| Component | Mobile | Desktop |
|-----------|--------|---------|
| Legend | `SheetTitle` (default ~20px) | `CardTitle` + `text-sm` (~14px) |
| Settings | `SheetTitle` (default ~20px) | `h3` + `text-sm font-semibold` (~14px) |

### Descriptions

| Component | Mobile | Desktop |
|-----------|--------|---------|
| Legend | None | N/A |
| Settings | **Removed** (was `SheetDescription`) | N/A |

### Content Text

| Component | Mobile | Desktop |
|-----------|--------|---------|
| Legend | Line IDs in badges (`text-sm font-semibold`) | Same |
| Settings | Labels (`text-sm font-medium`), descriptions (`text-xs text-muted-foreground`) | Same |

---

## 6. Identified Inconsistencies

### ✅ Mobile Improvements (Completed)

1. **Component Separation** ✅
   - Legend: Separated into LegendSheet.tsx (mobile) + LegendPanel.tsx (desktop)
   - Settings: Separated into SettingsSheet.tsx (mobile) + SettingsMenu.tsx (desktop)
   - **Benefit**: Better code organization, clearer separation of concerns

2. **Mobile Separator Spacing** ✅
   - Was: Legend `my-4`, Settings `my-1`
   - Now: Both use `my-3` (standardized)
   - **Benefit**: Consistent visual rhythm

3. **Mobile Max Height** ✅
   - Was: Legend had `max-h-[80vh]`, Settings didn't
   - Now: Both use `max-h-[80vh]`
   - **Benefit**: Consistent viewport handling

4. **Mobile Horizontal Padding** ✅
   - Both now use `px-2` for content containers
   - **Benefit**: Consistent edge spacing

### ✅ Desktop Improvements (Completed)

1. **Desktop Card Structure** ✅
   - Legend: Uses `CardHeader` + `CardTitle` + `CardContent`
   - Settings: Now uses `CardHeader` + `CardTitle` + `CardContent` (standardized)
   - **Benefit**: Consistent semantic structure and visual hierarchy

2. **Desktop Card Top Padding** ✅
   - Legend: `CardHeader pb-2` + `CardContent pt-0`
   - Settings: Now uses `CardHeader pb-2` + `CardContent pt-0` (standardized)
   - **Benefit**: Consistent title positioning

3. **Title Wrapper Spacing** ✅
   - Legend Desktop: `CardTitle` with `text-sm`
   - Settings Desktop: Now uses `CardTitle` with `text-sm` (standardized)
   - **Benefit**: Consistent spacing and typography

4. **Content Padding** ✅
   - Both now use `pt-0 pb-3` for CardContent
   - **Benefit**: Consistent vertical rhythm

### 🟡 Intentional Differences (Design Decisions)

1. **Desktop Card Width**
   - Legend: `w-64` (16rem / 256px) - Narrower for compact line grid
   - Settings: `w-80` (20rem / 320px) - Wider for readable text content
   - **Rationale**: Different content types require different widths

---

## 7. Proposed Standardization

### Standards to Establish

#### A. Desktop Card Structure (Preferred: Legend Pattern)

```tsx
<Card className="fixed {position} w-{width} shadow-lg z-10">
  <CardHeader className="pb-2">
    <CardTitle className="flex items-center justify-between text-sm">
      <span>{Title}</span>
      <div className="flex gap-1">
        {/* Action buttons */}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">✕</Button>
      </div>
    </CardTitle>
  </CardHeader>
  <CardContent className="pt-0 pb-3">
    {/* Content */}
  </CardContent>
</Card>
```

**Rationale**:
- Semantic HTML structure
- Consistent with ShadCN Card component patterns
- Built-in accessibility benefits from CardTitle

#### B. Desktop Card Dimensions

- **Width**: `w-64` (16rem) for simple panels, `w-80` (20rem) for content-heavy panels
- **Recommendation**: Keep Legend at `w-64`, Settings at `w-80` (Settings has more text content)

#### C. Mobile Sheet Spacing

```tsx
<SheetContent side="bottom" className="h-auto max-h-[80vh]">
  <SheetHeader>
    <SheetTitle>{Title}</SheetTitle>
    {description && <SheetDescription>{description}</SheetDescription>}
  </SheetHeader>
  <Separator className="my-3" />
  <div className="pb-6 px-2">
    {/* Content */}
  </div>
</SheetContent>
```

**Standards**:
- Max height: Always `max-h-[80vh]` for consistency
- Separator: `my-3` (balanced spacing - 0.75rem)
- Content container: `pb-6 px-2` (consistent horizontal padding)
- Description: Optional, use when helpful for UX

#### D. Button Consistency

**Collapsed Trigger Buttons (Desktop)**:
```tsx
<button
  className="fixed {top} left-4 w-12 h-12 rounded-full bg-card shadow-lg z-10
             flex items-center justify-center hover:scale-105 transition-transform
             border border-border"
>
  {/* Icon */}
</button>
```

**Close Buttons (All)**:
```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-6 w-6 p-0"
>
  ✕
</Button>
```

---

## 8. Action Items for Standardization

### Phase 1: Mobile Standardization ✅ COMPLETE

1. ✅ **Component Separation**: Created SettingsSheet.tsx as dedicated mobile component
2. ✅ **Settings Mobile**: Added `max-h-[80vh]` for viewport safety
3. ✅ **Settings Mobile**: Adjusted separator spacing (`my-1` → `my-3`)
4. ✅ **Settings Mobile**: Standardized horizontal padding to `px-2`

### Phase 2: Desktop Standardization ✅ COMPLETE

5. ✅ **Settings Desktop**: Refactored to use `CardHeader` + `CardTitle` pattern
6. ✅ **Settings Desktop**: Adjusted padding to match Legend (`pb-2` for header, `pt-0 pb-3` for content)
7. ✅ **Settings Desktop**: Card width - Keeping `w-80` for Settings (intentional, better for text content)

### Phase 3: Documentation ✅ COMPLETE

8. ✅ Document standard patterns in this file
9. ✅ Document component structure and separation
10. ⏳ Create reusable component abstraction (optional future work)

### Phase 4: Validation

11. ⏳ Visual regression testing (Playwright screenshots)
12. ⏳ Accessibility audit (ensure semantic structure is preserved)
13. ⏳ Mobile usability testing (ensure touch targets remain WCAG compliant)

---

## 9. Component Patterns Reference

### Standard Desktop Card Panel

```tsx
<Card className="fixed top-{n} left-4 w-{size} shadow-lg z-10">
  <CardHeader className="pb-2">
    <CardTitle className="flex items-center justify-between text-sm">
      <span>{title}</span>
      <div className="flex gap-1">
        {conditionalActionButtons}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">✕</Button>
      </div>
    </CardTitle>
  </CardHeader>
  <CardContent className="pt-0 pb-3">
    {content}
  </CardContent>
</Card>
```

### Standard Mobile Bottom Sheet

```tsx
<SheetContent side="bottom" className="h-auto max-h-[80vh]">
  <SheetHeader>
    <SheetTitle>{title}</SheetTitle>
    {description && <SheetDescription>{description}</SheetDescription>}
  </SheetHeader>
  <Separator className="my-3" />
  <div className="pb-6 px-2">
    {content}
  </div>
  {conditionalFooterActions}
</SheetContent>
```

---

## 10. Notes

- All measurements use Tailwind spacing scale (1 unit = 0.25rem)
- ShadCN components provide baseline accessibility (ARIA attributes, keyboard nav)
- Current implementations are functional but lack visual consistency
- Standardization will improve maintainability and user experience

**Next Steps**: Review this analysis, approve standardization targets, then implement Phase 1 fixes.
