import Person from 'app/Person';

export enum Genders {
    Male = 'male',
    Female = 'female',
};

export type Gender = Genders;

export enum Relationships {
    Father = 'father',
    Mother = 'mother',
    Spouse = 'spouse',
    Child = 'child',
    Sibling = 'sibling',
};

export type Relationship = Relationships;

export type RelationshipMap = { 
    [Relationships.Father]?: Person;
    [Relationships.Mother]?: Person;
    [Relationships.Spouse]?: Person;
    [Relationships.Child]?: Person[];
    [Relationships.Sibling]?: Person[];
};

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
    [Relationships.Spouse]?: string;
    [Relationships.Child]?: string;
    [Relationships.Sibling]?: string;
};

export type RelationshipProbabilities = {
    [Relationships.Father]: number;
    [Relationships.Mother]: number;
    [Relationships.Spouse]: number;
    [Relationships.Child]: number;
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
