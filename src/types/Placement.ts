// The placement-tag vocabulary (task 069): the controlled, validated list of environmental contexts a
// building can contain and an object can plausibly occur in. Curated from the 54 settings of
// docs/planning/settings-and-objects.md. `scope: 'building'` tags are attachable to business blueprints and
// residences today; `'deferred'` tags are public/venue settings awaiting the venue model (055/future) —
// objects carry them already so that world lights up without a data pass.

export interface PlacementTagSpec {
    label: string;
    scope: 'building' | 'deferred';
}

export interface PlacementConfig {
    tags: Record<string, PlacementTagSpec>;
}

// json/residences.json: the context-tag sets of residential building types (houses today).
export interface ResidencesConfig {
    house: { tags: string[] };
}
