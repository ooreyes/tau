import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSchematic } from "../store/useSchematic";
import { pickModelLibraryFile, type PickedTextFile } from "../project/fsBridge";
import {
  discoverInstalledLtspiceLibrary,
  readInstalledLtspiceModel,
  type InstalledLtspiceLibrary,
} from "../project/installedLtspiceLibrary";
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

function attachmentLimitError(
  libraries: readonly { name: string; text: string }[],
  picked: PickedTextFile,
): string | null {
  const replacing = libraries.some((library) => library.name === picked.name);
  if (!replacing && libraries.length >= MAX_MODEL_LIBRARIES) {
    return `Tau supports up to ${MAX_MODEL_LIBRARIES} attached model files.`;
  }
  const existingTotal = libraries
    .filter((library) => library.name !== picked.name)
    .reduce((sum, library) => sum + library.text.length, 0);
  if (existingTotal + picked.text.length > MAX_MODEL_LIBRARY_TOTAL_LENGTH) {
    return `Attaching ${picked.name} would exceed the ${MAX_MODEL_LIBRARY_TOTAL_LENGTH.toLocaleString("en-US")}-character limit for attached model files.`;
  }
  return null;
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
  const [installed, setInstalled] = useState<InstalledLtspiceLibrary | null>(null);
  const [installedSearch, setInstalledSearch] = useState("");
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [attachingInstalledId, setAttachingInstalledId] = useState<string | null>(null);

  const visibleInstalledFiles = useMemo(() => {
    if (!installed) return [];
    const query = installedSearch.trim().toLocaleLowerCase();
    return installed.files
      .filter((file) => !query || `${file.name} ${file.category} ${file.id}`.toLocaleLowerCase().includes(query))
      .slice(0, 80);
  }, [installed, installedSearch]);

  const attachPicked = (picked: PickedTextFile): boolean => {
    const limitError = attachmentLimitError(libraries, picked);
    if (limitError) {
      setError(limitError);
      return false;
    }
    attachModelLibrary(picked);
    setError(null);
    return true;
  };

  const handleAttach = async () => {
    try {
      const picked = await pickModelLibraryFile();
      if (!picked) return;
      attachPicked(picked);
    } catch (err) {
      setError(userFacingErrorMessage(err, "Could not attach that model file."));
    }
  };

  const handleDiscoverInstalled = async () => {
    setLoadingInstalled(true);
    setError(null);
    try {
      setInstalled(await discoverInstalledLtspiceLibrary());
    } catch (err) {
      setError(userFacingErrorMessage(err, "Could not find the installed LTspice model library."));
    } finally {
      setLoadingInstalled(false);
    }
  };

  const handleAttachInstalled = async (id: string) => {
    setAttachingInstalledId(id);
    setError(null);
    try {
      attachPicked(await readInstalledLtspiceModel(id));
    } catch (err) {
      setError(userFacingErrorMessage(err, "Could not attach that installed LTspice model."));
    } finally {
      setAttachingInstalledId(null);
    }
  };

  const handleRemove = (name: string) => {
    removeModelLibrary(name);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(820px,calc(100vh-32px))] max-w-[640px] overflow-y-auto" aria-describedby="model-libraries-desc">
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

        <section className="grid gap-3 border-t border-border pt-4" aria-labelledby="installed-ltspice-models-title">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <h3 id="installed-ltspice-models-title" className="text-sm font-semibold text-foreground">Installed LTspice models</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Read-only access to your local LTspice library. Only the model you choose is copied into this schematic; Tau never bundles the installed library.
              </p>
            </div>
            {!installed && (
              <Button type="button" variant="outline" size="sm" disabled={loadingInstalled} onClick={() => void handleDiscoverInstalled()}>
                {loadingInstalled ? "Finding…" : "Find installed library"}
              </Button>
            )}
          </div>

          {installed && (
            <>
              <div className="grid gap-1">
                <span className="truncate text-xs text-muted-foreground" title={installed.root}>{installed.root}</span>
                <span className="text-xs text-muted-foreground">{installed.files.length.toLocaleString("en-US")} attachable text-model files found.</span>
              </div>
              <Input
                aria-label="Search installed LTspice models"
                value={installedSearch}
                onChange={(event) => setInstalledSearch(event.currentTarget.value)}
                placeholder="Search part or filename…"
              />
              <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-border p-1" aria-label="Installed LTspice model files">
                {visibleInstalledFiles.map((file) => {
                  const alreadyAttached = libraries.some((library) => library.name === file.name);
                  return (
                    <li className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 hover:bg-muted" key={file.id}>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-xs font-medium text-foreground">{file.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{file.category} · {(file.bytes / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })} KB</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={alreadyAttached || attachingInstalledId !== null}
                        aria-label={`Attach installed model ${file.id}`}
                        onClick={() => void handleAttachInstalled(file.id)}
                      >
                        {alreadyAttached ? "Attached" : attachingInstalledId === file.id ? "Attaching…" : "Attach"}
                      </Button>
                    </li>
                  );
                })}
                {visibleInstalledFiles.length === 0 && (
                  <li className="px-2 py-3 text-xs text-muted-foreground">No installed model matches that search.</li>
                )}
              </ul>
              {visibleInstalledFiles.length === 80 && (
                <p className="text-xs text-muted-foreground">Showing the first 80 matches. Refine the search to find a specific part.</p>
              )}
            </>
          )}
        </section>

        <DialogFooter>
          <Button size="sm" onClick={() => void handleAttach()}>
            Attach model file...
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
