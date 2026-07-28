/**
 * Shared constants for every "Import" entry point (Explorer header, empty
 * state, drag-and-drop) so the accept list and label can't drift between them.
 */

/** Every extension `planFileImport` can route somewhere - including the ones
 *  Tau refuses on purpose (`.raw`, `.kicad_sch`) so the file picker doesn't
 *  hide them and leave the user wondering where they went. */
export const IMPORT_ACCEPT =
  ".asc,.cir,.net,.sp,.spi,.ckt,.lib,.sub,.subckt,.mod,.raw,.kicad_sch";

export const IMPORT_BUTTON_LABEL = "Import circuit";
