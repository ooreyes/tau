/**
 * Official VS Code Codicon paths (@vscode/codicons) for the explorer action
 * row — filled glyphs tinted via `currentColor`, matching VS Code 1:1.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Codicon({
  className,
  title,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      className={className}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Codicon `new-file`. */
export function VscodeNewFileIcon(props: IconProps) {
  return (
    <Codicon className="vscode-explorer-icon vscode-new-file" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.5 1.1l3.4 3.5.1.4v2h-1V6H8V2H3v11h4v1H2.5l-.5-.5v-12l.5-.5h6.7l.3.1zM9 2v3h2.9L9 2zm4 14h-1v-3H9v-1h3V9h1v3h3v1h-3v3z"
      />
    </Codicon>
  );
}

/** Codicon `new-folder`. */
export function VscodeNewFolderIcon(props: IconProps) {
  return (
    <Codicon className="vscode-explorer-icon vscode-new-folder" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.5 2H7.71l-.85-.85L6.51 1h-5l-.5.5v11l.5.5H7v-1H1.99V6h4.49l.35-.15.86-.86H14v1.5l-.001.51h1.011V2.5L14.5 2zm-.51 2h-6.5l-.35.15-.86.86H2v-3h4.29l.85.85.36.15H14l-.01.99zM13 16h-1v-3H9v-1h3V9h1v3h3v1h-3v3z"
      />
    </Codicon>
  );
}

/**
 * File with inbound arrow — matches the VS Code-style “open/import file”
 * glyph from the explorer action strip (not a stock single codicon name).
 */
export function VscodeImportFileIcon(props: IconProps) {
  return (
    <Codicon className="vscode-explorer-icon vscode-import-file" {...props}>
      <path d="M9.5 1H4.5l-.5.5v3H5V2h4v3h3v9H5v-1.5H4V14.5l.5.5h8l.5-.5v-10L9.5 1zM9 2.2 11.8 5H9V2.2z" />
      <path d="M1 8.5h5.3L4.65 6.85l.7-.7L8.2 9l-2.85 2.85-.7-.7L6.3 9.5H1v-1z" />
    </Codicon>
  );
}

/** Folder with inbound arrow — open/import folder counterpart. */
export function VscodeImportFolderIcon(props: IconProps) {
  return (
    <Codicon className="vscode-explorer-icon vscode-import-folder" {...props}>
      <path d="M14.5 3H8.21l-.85-.85L6.01 2h-1.5l-.5.5V4H8.5l.35.15.86.85H14v1.5h1V3.5L14.5 3zM8 4.99 7.15 4.14 6.79 4H5v-.5h1.29l.85.85.36.15H8v.49z" />
      <path d="M14.5 7H8.21l-.35-.15L7 5.99H1.5L1 6.5v7l.5.5h13l.5-.5v-6L14.5 7zM14 13H2V7h4.79l.86.86.35.14H14v5z" />
      <path d="M3 9.5h4.3L5.65 7.85l.7-.7L8.2 10l-2.85 2.85-.7-.7L7.3 10.5H3v-1z" />
    </Codicon>
  );
}

/** Codicon `refresh`. */
export function VscodeRefreshIcon(props: IconProps) {
  return (
    <Codicon className="vscode-explorer-icon vscode-refresh" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.681 3H2V2h3.5l.5.5V6H5V4a5 5 0 1 0 4.53-.761l.302-.954A6 6 0 1 1 4.681 3z"
      />
    </Codicon>
  );
}

/** Codicon `collapse-all`. */
export function VscodeCollapseAllIcon(props: IconProps) {
  return (
    <Codicon className="vscode-explorer-icon vscode-collapse-all" {...props}>
      <path d="M9 9H4v1h5V9z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5 3l1-1h7l1 1v7l-1 1h-2v2l-1 1H3l-1-1V6l1-1h2V3zm1 2h4l1 1v4h2V3H6v2zm4 1H3v7h7V6z"
      />
    </Codicon>
  );
}
