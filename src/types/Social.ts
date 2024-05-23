import Person from 'app/Person';

export enum Genders {
    Male = 'male',
    Female = 'female',
}

export type Gender = Genders;

export enum Relationships {
    Father = 'father',
    Mother = 'mother',
    Grandfather = 'grandfather',
    Grandmother = 'grandmother',
    Child = 'child',
    Grandchild = 'grandchild',
    Sibling = 'sibling',
}

export type Relationship = Relationships;

export type RelationshipMap = { 
    [key in Relationship]?: Person[] 
};

export type SocialInfo = {
    firstName: string;
    familyName: string;
    age: number;
    gender: Gender;
    relationships: RelationshipMap;
}

export type RelationshipOverview = {
    [key in Relationship]?: string[];
};

export type PersonOverview = {
    firstName: string;
    familyName: string;
    age: number;
    gender: Gender;
    relationships: RelationshipOverview;
}

export type HouseOverview = {
    maxResidents: number;
    maxOccupants: number;
    maxVehicles: number;
}

export type FamilyOverview = {
    familyName: string;
    household: HouseOverview;
    members: PersonOverview[];
}