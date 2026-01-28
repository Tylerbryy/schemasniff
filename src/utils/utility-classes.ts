/**
 * Utility class detection for filtering out Tailwind, Bootstrap, and other
 * utility-first CSS frameworks when building semantic selectors.
 */

export const UTILITY_CLASSES = [
  // Layout
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid',
  'hidden', 'visible', 'invisible', 'contents', 'flow-root',
  // Positioning
  'relative', 'absolute', 'fixed', 'sticky', 'static',
  // Flexbox
  'items-center', 'items-start', 'items-end', 'items-stretch', 'items-baseline',
  'justify-center', 'justify-start', 'justify-end', 'justify-between', 'justify-around',
  'flex-row', 'flex-col', 'flex-wrap', 'flex-nowrap', 'flex-1', 'grow', 'shrink',
  // Spacing (common patterns)
  'p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-8', 'p-10', 'p-12',
  'm-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-8', 'm-10', 'm-12',
  'px-0', 'px-1', 'px-2', 'px-3', 'px-4', 'px-5', 'px-6', 'px-8',
  'py-0', 'py-1', 'py-2', 'py-3', 'py-4', 'py-5', 'py-6', 'py-8',
  'mx-auto', 'my-auto', 'mt-0', 'mt-1', 'mt-2', 'mt-4', 'mb-0', 'mb-1', 'mb-2', 'mb-4',
  'gap-0', 'gap-1', 'gap-2', 'gap-3', 'gap-4', 'gap-5', 'gap-6', 'gap-8',
  // Sizing
  'w-full', 'w-auto', 'w-screen', 'h-full', 'h-auto', 'h-screen',
  'min-w-0', 'min-h-0', 'max-w-full', 'max-h-full',
  // Text
  'text-left', 'text-center', 'text-right', 'text-justify',
  'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl',
  'font-normal', 'font-medium', 'font-semibold', 'font-bold',
  'truncate', 'overflow-hidden', 'overflow-auto', 'overflow-scroll',
  // Colors (generic)
  'bg-white', 'bg-black', 'bg-transparent', 'text-white', 'text-black',
  // Borders
  'border', 'border-0', 'border-2', 'rounded', 'rounded-md', 'rounded-lg', 'rounded-full',
  // Effects
  'shadow', 'shadow-sm', 'shadow-md', 'shadow-lg', 'opacity-0', 'opacity-50', 'opacity-100',
  // Transitions
  'transition', 'transition-all', 'duration-150', 'duration-200', 'duration-300',
  // Bootstrap
  'container', 'row', 'col', 'd-flex', 'd-block', 'd-none', 'd-inline',
  'align-items-center', 'justify-content-center',
  // Common generic
  'clearfix', 'wrapper', 'inner', 'outer', 'content', 'main'
] as const;

export const UTILITY_CLASS_SET = new Set(UTILITY_CLASSES);

/**
 * Check if a CSS class is a utility class (Tailwind, Bootstrap, etc.)
 * Uses both set lookup and regex patterns for common utility patterns.
 */
export function isUtilityClass(cls: string): boolean {
  if (UTILITY_CLASS_SET.has(cls)) return true;
  // Classes with special CSS characters that would break selectors
  if (/[:\[\]*@#>~+]/.test(cls)) return true;
  // Responsive/state prefixes: sm:, hover:, focus:, etc.
  if (/^(sm|md|lg|xl|2xl|hover|focus|active|disabled|dark|light):/.test(cls)) return true;
  // Spacing utilities: m-4, px-[20px], -mt-2, etc.
  if (/^-?(m|p)(t|r|b|l|x|y)?-\[?.+\]?$/.test(cls)) return true;
  // Sizing utilities: w-1/2, h-[100px], etc.
  if (/^(w|h|min-w|min-h|max-w|max-h)-\[?.+\]?$/.test(cls)) return true;
  // Color utilities: bg-gray-100, text-blue-500, etc.
  if (/^(text|bg|border|ring)-(gray|slate|zinc|neutral|red|blue|green|yellow|purple|pink|orange|indigo|teal|cyan)-\d+/.test(cls)) return true;
  // Grid utilities: grid-cols-3, col-span-2, etc.
  if (/^grid-(cols|rows)-\d+$/.test(cls) || /^(col|row)-span-\d+$/.test(cls)) return true;
  // Text size utilities
  if (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/.test(cls)) return true;
  // Font weight utilities
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(cls)) return true;
  return false;
}

/**
 * Get semantic (non-utility) classes from an element's className.
 */
export function getSemanticClasses(className: string): string[] {
  if (!className) return [];
  return className.toString().trim().split(/\s+/).filter(cls => !isUtilityClass(cls));
}

/**
 * Generate injectable code string for use in page.evaluate().
 * This serializes the utility class logic so it can run in browser context.
 */
export function getInjectableUtilityLogic(): string {
  return `
    const utilityClassSet = new Set(${JSON.stringify(UTILITY_CLASSES)});

    function isUtilityClass(cls) {
      if (utilityClassSet.has(cls)) return true;
      if (/[:\\[\\]*@#>~+]/.test(cls)) return true;
      if (/^(sm|md|lg|xl|2xl|hover|focus|active|disabled|dark|light):/.test(cls)) return true;
      if (/^-?(m|p)(t|r|b|l|x|y)?-\\[?.+\\]?$/.test(cls)) return true;
      if (/^(w|h|min-w|min-h|max-w|max-h)-\\[?.+\\]?$/.test(cls)) return true;
      if (/^(text|bg|border|ring)-(gray|slate|zinc|neutral|red|blue|green|yellow|purple|pink|orange|indigo|teal|cyan)-\\d+/.test(cls)) return true;
      if (/^grid-(cols|rows)-\\d+$/.test(cls) || /^(col|row)-span-\\d+$/.test(cls)) return true;
      if (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/.test(cls)) return true;
      if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(cls)) return true;
      return false;
    }

    function getSemanticClasses(el) {
      const className = el.className?.toString?.()?.trim?.() || '';
      if (!className) return [];
      return className.split(/\\s+/).filter(cls => !isUtilityClass(cls));
    }

    function getSemanticClassSelector(el) {
      const semantic = getSemanticClasses(el);
      return semantic.length > 0 ? '.' + semantic[0] : '';
    }
  `;
}
