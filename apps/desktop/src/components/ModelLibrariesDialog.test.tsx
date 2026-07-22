// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsBridge = vi.hoisted(() => ({
  pickModelLibraryFile: vi.fn(),
}));

vi.mock("../project/fsBridge", () => fsBridge);

import { ModelLibrariesDialog } from "./ModelLibrariesDialog";
import { useSchematic } from "../store/useSchematic";

afterEach(() => cleanup());
beforeEach(() => {
  fsBridge.pickModelLibraryFile.mockReset();
  useSchematic.setState({ userModelLibraries: [], past: [], future: [] });
});

describe("ModelLibrariesDialog", () => {
  it("renders the empty state when nothing is attached", () => {
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Model libraries" })).toBeTruthy();
    expect(screen.getByText(/No model files are attached yet/)).toBeTruthy();
  });

  it("attaches a picked file", async () => {
    fsBridge.pickModelLibraryFile.mockResolvedValue({ name: "opamps.lib", text: ".subckt OPX 1 2 3\n.ends\n" });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    await waitFor(() => expect(useSchematic.getState().userModelLibraries).toEqual([
      { name: "opamps.lib", text: ".subckt OPX 1 2 3\n.ends\n" },
    ]));
    expect(await screen.findByText("opamps.lib")).toBeTruthy();
  });

  it("attaches nothing when the picker is cancelled", async () => {
    fsBridge.pickModelLibraryFile.mockResolvedValue(null);
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    await waitFor(() => expect(fsBridge.pickModelLibraryFile).toHaveBeenCalledTimes(1));
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("removes an attachment", async () => {
    useSchematic.getState().attachModelLibrary({ name: "diodes.lib", text: "* diodes" });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove diodes.lib" }));

    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("shows an inline error and does not open the picker at the attachment cap", async () => {
    useSchematic.setState({
      userModelLibraries: Array.from({ length: 64 }, (_, i) => ({ name: `lib-${i}.lib`, text: "* x" })),
    });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Tau supports up to 64 attached model files.",
    );
    expect(fsBridge.pickModelLibraryFile).not.toHaveBeenCalled();
  });

  it("surfaces a thrown picker error inline", async () => {
    fsBridge.pickModelLibraryFile.mockRejectedValue(new Error("Attaching model files requires the Tau desktop app or a browser with file access."));
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Attaching model files requires the Tau desktop app or a browser with file access.",
    );
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });
});
