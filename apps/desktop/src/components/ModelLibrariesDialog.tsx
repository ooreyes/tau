import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSchematic } from "../store/useSchematic";
import { pickModelLibraryFile } from "../project/fsBridge";
import { userFacingErrorMessage } from "../lib/errorMessage";
import { MAX_MODEL_LIBRARIES, MAX_MODEL_LIBRARY_TOTAL_LENGTH } from "../schematic/documentValidation";

interface ModelLibrariesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** KB display for an attachment - derived from the raw text length (UTF-16
 *  code units), close enough for a size hint and consistent with how the
 *  aggregate cap below is itself measured. */
function sizeKb(text: string): string {
  return (text.length / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/**
 * Lets the user attach, list, and remove vendor SPICE model files (`.lib` /
 * `.subckt`) on the current document. Attachments resolve by name against any
 * placed part whose model/subcircuit Tau doesn't build in - the safe stand-in
 * for LTspice's `.include`/`.lib` (see {@link SchematicModelLibrary}).
 */
export function ModelLibrariesDialog({ open, onOpenChange }: ModelLibrariesDialogProps) {
  const libraries = useSchematic((s) => s.userModelLibraries);
  const attachModelLibrary = useSchematic((s) => s.attachModelLibrary);
  const removeModelLibrary = useSchematic((s) => s.removeModelLibrary);
  const [error, setError] = useState<string | null>(null);

  const handleAttach = async () => {
    if (libraries.length >= MAX_MODEL_LIBRARIES) {
      setError(`Tau supports up to ${MAX_MODEL_LIBRARIES} attached model files.`);
      return;
    }
    try {
      const picked = await pickModelLibraryFile();
      if (!picked) return;
      // A re-attach of the same name replaces it in place (see
      // attachModelLibrary), so exclude the entry it would replace when
      // checking the aggregate cap.
      const existingTotal = libraries
        .filter((library) => library.name !== picked.name)
        .reduce((sum, library) => sum + library.text.length, 0);
      if (existingTotal + picked.text.length > MAX_MODEL_LIBRARY_TOTAL_LENGTH) {
        setError(
          `Attaching ${picked.name} would exceed the ${MAX_MODEL_LIBRARY_TOTAL_LENGTH.toLocaleString("en-US")}-character limit for attached model files.`,
        );
        return;
      }
      attachModelLibrary(picked);
      setError(null);
    } catch (err) {
      setError(userFacingErrorMessage(err, "Could not attach that model file."));
    }
  };

  const handleRemove = (name: string) => {
    removeModelLibrary(name);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]" aria-describedby="model-libraries-desc">
        <DialogHeader>
          <DialogTitle>Model libraries</DialogTitle>
          <DialogDescription id="model-libraries-desc">
            Attached vendor SPICE model files (.lib / .subckt) are saved with this schematic.
            A placed part whose model or subcircuit is not built in resolves against them by
            name when a simulation runs.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        {libraries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No model files are attached yet. Attach a vendor .lib or .subckt file to resolve
            parts that reference a model Tau doesn't build in.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {libraries.map((library) => (
              <li
                key={library.name}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-foreground">{library.name}</span>
                  <span className="text-xs text-muted-foreground">{sizeKb(library.text)} KB</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${library.name}`}
                  onClick={() => handleRemove(library.name)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button size="sm" onClick={() => void handleAttach()}>
            Attach model file...
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
