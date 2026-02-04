/**
 * Icon - Simple SVG icon component for ekacode
 *
 * Provides a minimal set of icons using inline SVG paths.
 * Designed to be lightweight and consistent with ekacode's aesthetic.
 */

type IconName =
  | "chevron-down"
  | "chevron-right"
  | "chevron-up"
  | "check"
  | "close"
  | "x"
  | "spinner"
  | "clock"
  | "copy"
  | "terminal"
  | "file"
  | "folder";

interface IconProps {
  /** Icon name to render */
  name: IconName;
  /** Additional CSS classes */
  class?: string;
  /** Whether the icon is spinning (for spinner) */
  spin?: boolean;
}

const iconPaths: Record<IconName, string> = {
  "chevron-down": "M19 9l-7 7-7-7",
  "chevron-right": "M9 5l7 7-7 7",
  "chevron-up": "M5 15l7-7 7 7",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z",
  close:
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
  x: "M6 18L18 6M6 6l12 12",
  spinner: "", // Special handling for spinner
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  copy: "M8 4H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2v-2M16 4h2a2 2 0 012 2v4M21 14H11m4 0l-3 3m3-3l-3-3",
  terminal: "M4 17l6-6-6-6M12 19h8",
  file: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  folder: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
};

/**
 * Icon component
 *
 * @example
 * ```tsx
 * <Icon name="check" class="text-green-500" />
 * <Icon name="spinner" spin />
 * ```
 */
export function Icon(props: IconProps) {
  const path = iconPaths[props.name];

  // Special handling for spinner icon
  if (props.name === "spinner") {
    return (
      <svg
        class={props.class}
        fill="none"
        viewBox="0 0 24 24"
        classList={{ "animate-spin": props.spin !== false }}
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    );
  }

  return (
    <svg
      class={props.class}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
