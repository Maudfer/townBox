import Person from 'app/Person';

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

export type RelationshipList = { 
    [key in Relationship]?: Person[] 
};

export type SocialInfo = {
    firstName: string;
    familyName: string;
    age: number;
    gender: Gender;
    relationships: RelationshipList;
}