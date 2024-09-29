import Person from 'game/Person';

export enum Genders {
    Male = 'male',
    Female = 'female',
};

export type Gender = Genders;

export enum Relationships {
    Father = 'father',
    Mother = 'mother',
    Grandfather = 'grandfather',
    Grandmother = 'grandmother',
    Spouse = 'spouse',
    Child = 'child',
    Grandchild = 'grandchild',
    Sibling = 'sibling',
    Uncle = 'uncle',
    Aunt = 'aunt',
    Niece = 'niece',
    Nephew = 'nephew',
};

export type Relationship = Relationships;

export type RelationshipMap = { 
    [Relationships.Father]?: Person;
    [Relationships.Mother]?: Person;
    [Relationships.Grandfather]?: Person;
    [Relationships.Grandmother]?: Person;
    [Relationships.Spouse]?: Person;
    [Relationships.Child]?: Person[];
    [Relationships.Grandchild]?: Person[];
    [Relationships.Sibling]?: Person[];
    [Relationships.Uncle]?: Person[];
    [Relationships.Aunt]?: Person[];
    [Relationships.Niece]?: Person[];
    [Relationships.Nephew]?: Person[];
};

// Only used for building overviews
export type SocialInfo = {
    firstName: string;
    familyName: string;
    age: number;
    gender: Gender;
    relationships: RelationshipMap;
};

export type RelationshipMapOverview = {
    [Relationships.Father]?: string;
    [Relationships.Mother]?: string;
    [Relationships.Grandfather]?: string;
    [Relationships.Grandmother]?: string;
    [Relationships.Spouse]?: string;
    [Relationships.Child]?: string;
    [Relationships.Grandchild]?: string;
    [Relationships.Sibling]?: string;
    [Relationships.Uncle]?: string;
    [Relationships.Aunt]?: string;
    [Relationships.Niece]?: string;
    [Relationships.Nephew]?: string;
};

export type PersonOverview = {
    firstName: string;
    familyName: string;
    age: number;
    gender: Gender;
    relationships: RelationshipMapOverview;
};

export type HouseOverview = {
    maxResidents: number;
    maxOccupants: number;
    maxVehicles: number;
};

export type FamilyOverview = {
    familyName: string;
    household: HouseOverview;
    members: PersonOverview[];
};

export type WorkplaceOverview = {
    maxOccupants: number;
    maxVehicles: number;
    occupants: PersonOverview[];
    employees: PersonOverview[];
};
