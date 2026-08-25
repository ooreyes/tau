# Live switched divider

Open `live-switched-divider.sim` in the packaged Tau app and choose **Live**.
The `SW_DIV` contact is a hand-operable static switch in series with `R_LOAD`.
With the default `open` state, `V_OUT` is near 0 V; click **Toggle SW_DIV** in
the Live controls to close the contact and watch `V_OUT` rise to approximately
5 V. Toggle it again to return to the open state. Stop Live before editing.

The contract check in `apps/desktop/scripts/packagedLiveFixtures.corpus.ts`
builds the same transient deck and proves that the planner resolves the exact
`R_SW_DIV` alter target emitted by Tau.
