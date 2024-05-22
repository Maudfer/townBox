import Person from 'app/Person';
import House from 'app/House';

export enum Genders {
    Male = 'male',
    Female = 'female',
}

export type Gender = Genders;

export enum Relationships {
    Father = 'father',
    Mother = 'mother',
    Child = 'child',
    Sibling = 'sibling',
}

export type Relationship = 'father' | 'mother' | 'child' | 'sibling';

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

export type FamilyOverview = {
    familyName: string;
    household: House;
    members: PersonOverview[];
}