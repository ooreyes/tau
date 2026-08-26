# Live digital path

Open `live-digital-path.sim` in the packaged Tau app and choose **Live**.
`LOGIC_IN` is a Tau-native logic constant at 0 V. Its `BUF_OUT` digital gate
drives the named `LOGIC_OUT` net and `R_LOGIC_LOAD`. The gate uses a 0.5 V
threshold so the fixture's 0 V / 1 V live control levels are both valid logic
states. Use the **Toggle LOGIC_IN** control to switch the input between 0 (LOW)
and 1 V (HIGH); the real emitted behavioral digital output follows the
transition. Stop Live before editing.

The contract check in `apps/desktop/scripts/packagedLiveFixtures.corpus.ts`
builds the transient deck and proves that the planner resolves the exact
deck-owned voltage-source target for the logic input.
