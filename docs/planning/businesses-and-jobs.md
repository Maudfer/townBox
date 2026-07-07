# Businesses & Jobs — Content Planning Catalog

Planning input for future runtime JSON data (business blueprints in `src/json/businesses.json`, jobs in `src/json/jobs.json`, and the upcoming Actions system). This document is a content catalog, not runtime data — names are human-readable titles, to be snake_cased when they graduate into JSON manifests. Demand categories are guesses drawn from: groceries, dining, healthcare, education, construction, retail, leisure, services, hospitality, production/B2B, civic.

**Verified counts (script-generated):**

- Business types: **163**
- Total job entries across all businesses (before dedupe): **720**
- Deduped job titles: **213**

Companion file: [`work-actions.md`](./work-actions.md) maps every deduped job title to continuous and discrete work Actions.

---

## 1. Business types

| business | demand category guess | related settings |
| --- | --- | --- |
| Supermarket | groceries | sales floor, checkout lanes, stockroom, loading dock |
| Grocery Store | groceries | sales floor, checkout counter, stockroom |
| Convenience Store | groceries | sales floor, front counter, back room |
| Butcher Shop | groceries | cutting room, display counter, cold room |
| Fish Market | groceries | ice displays, cutting station, cold storage |
| Greengrocer | groceries | produce stands, scale counter, back room |
| Delicatessen | groceries | deli counter, slicing station, seating nook |
| Cheese Shop | groceries | tasting counter, cheese cave, display cases |
| Liquor Store | groceries | shelving aisles, register, locked cabinet |
| Farmers' Market Hall | groceries | market stalls, central aisle, loading yard |
| Restaurant | dining | kitchen, dining room, bar, walk-in cooler |
| Diner | dining | griddle line, counter seating, booths |
| Fast Food Joint | dining | fry station, front counter, drive-through window |
| Pizzeria | dining | pizza oven, prep counter, dining area |
| Cafe | dining | espresso bar, seating area, pastry case |
| Bakery | dining | bakehouse, ovens, front counter |
| Ice Cream Parlor | dining | scooping counter, freezer room, seating |
| Sushi Bar | dining | sushi counter, kitchen, dining room |
| Steakhouse | dining | grill kitchen, dining room, wine cellar |
| Pub | dining | bar, kitchen, snug, beer cellar |
| Tea House | dining | tea bar, seating parlor, pantry |
| Juice Bar | dining | blending counter, produce fridge, seating |
| Cafeteria | dining | serving line, kitchen, dining hall |
| Buffet Restaurant | dining | buffet line, kitchen, dining hall |
| Hospital | healthcare | wards, operating room, emergency room, reception |
| Medical Clinic | healthcare | exam rooms, waiting room, reception |
| Urgent Care Center | healthcare | triage area, exam rooms, waiting room |
| Dental Clinic | healthcare | treatment rooms, X-ray room, reception |
| Orthodontic Office | healthcare | treatment bays, imaging room, reception |
| Pharmacy | healthcare | dispensary counter, shelving aisles, stockroom |
| Optometry Practice | healthcare | exam room, frame gallery, lens lab |
| Veterinary Clinic | healthcare | exam rooms, kennels, surgery room |
| Physical Therapy Center | healthcare | exercise floor, treatment tables, reception |
| Psychology Practice | healthcare | session rooms, waiting room, reception |
| Nursing Home | healthcare | resident rooms, common room, dining hall, garden |
| Medical Laboratory | healthcare | lab benches, sample intake, cold storage |
| Blood Donation Center | healthcare | donation chairs, screening room, snack table |
| Dermatology Clinic | healthcare | exam rooms, procedure room, reception |
| Elementary School | education | classrooms, playground, cafeteria, gym |
| High School | education | classrooms, gymnasium, library, cafeteria |
| Kindergarten | education | playrooms, nap room, playground |
| Daycare Center | education | playrooms, crib room, snack corner |
| University | education | lecture halls, laboratories, library, quad |
| Trade School | education | workshops, classrooms, tool crib |
| Language School | education | classrooms, listening lab, lounge |
| Music School | education | practice rooms, recital hall, lobby |
| Driving School | education | classroom, practice lot, instruction cars |
| Tutoring Center | education | study rooms, reception, resource shelves |
| Art School | education | studios, kiln room, gallery hall |
| Dance Academy | education | dance studios, barre room, changing rooms |
| Construction Company | construction | site office, equipment yard, scaffolding |
| Architecture Firm | construction | drafting studio, model room, meeting room |
| Plumbing Company | construction | dispatch office, parts warehouse, service vans |
| Electrical Contractor | construction | dispatch office, wire stockroom, service vans |
| Roofing Company | construction | office, materials yard, ladder racks |
| Landscaping Company | construction | greenhouse, equipment shed, office |
| Painting Contractor | construction | office, paint storage, mixing room |
| Demolition Company | construction | equipment yard, site office, rubble pit |
| Carpentry Workshop | construction | woodshop, lumber racks, finishing room |
| Clothing Store | retail | sales floor, fitting rooms, stockroom |
| Shoe Store | retail | display wall, fitting benches, stockroom |
| Electronics Store | retail | demo floor, repair counter, stockroom |
| Hardware Store | retail | tool aisles, lumber corner, key-cutting counter |
| Bookstore | retail | book aisles, reading nook, register counter |
| Toy Store | retail | display aisles, demo table, stockroom |
| Furniture Store | retail | showroom floor, warehouse, loading dock |
| Jewelry Store | retail | display cases, workshop bench, vault |
| Pet Store | retail | animal enclosures, supply aisles, register |
| Sporting Goods Store | retail | gear aisles, fitting area, stockroom |
| Florist Shop | retail | arranging counter, flower cooler, front display |
| Music Store | retail | instrument floor, soundproof room, repair bench |
| Antique Shop | retail | crowded showroom, appraisal desk, back room |
| Thrift Store | retail | racks and bins, sorting room, register |
| Stationery Shop | retail | paper aisles, pen counter, gift-wrap station |
| Bicycle Shop | retail | showroom, repair stand, parts wall |
| Garden Center | retail | greenhouse, outdoor beds, register shed |
| Department Store | retail | sales floors, escalators, stockrooms, loading dock |
| Comic Book Shop | retail | comic racks, back-issue bins, gaming table |
| Perfume Shop | retail | scent counter, display shelves, stockroom |
| Mobile Phone Shop | retail | demo tables, repair counter, accessory wall |
| Gym | leisure | weight floor, cardio row, locker rooms, studio |
| Cinema | leisure | auditoriums, projection booth, concession stand, lobby |
| Bowling Alley | leisure | lanes, shoe counter, snack bar, machine room |
| Arcade | leisure | game floor, prize counter, token booth |
| Museum | leisure | exhibit halls, archives, ticket desk, gift shop |
| Art Gallery | leisure | exhibition rooms, storage vault, reception desk |
| Theater | leisure | stage, backstage, dressing rooms, box office |
| Public Swimming Pool | leisure | pool deck, locker rooms, lifeguard chair |
| Zoo | leisure | animal habitats, feed kitchen, visitor paths |
| Aquarium | leisure | tank galleries, feeding platforms, ticket desk |
| Casino | leisure | gaming floor, cashier cage, bar, security room |
| Nightclub | leisure | dance floor, DJ booth, bar, VIP lounge |
| Bar | leisure | bar counter, booth seating, back room |
| Escape Room | leisure | puzzle rooms, control room, briefing lobby |
| Mini Golf Course | leisure | putting greens, windmill hole, kiosk |
| Stadium | leisure | pitch, stands, concourse, ticket gates |
| Concert Hall | leisure | stage, orchestra pit, foyer, box office |
| Ice Skating Rink | leisure | ice rink, skate rental counter, bleachers |
| Yoga Studio | leisure | practice room, mat shelves, changing room |
| Climbing Gym | leisure | climbing walls, bouldering pit, gear desk |
| Bank | services | teller counter, vault, loan offices, lobby |
| Hair Salon | services | styling chairs, wash basins, reception |
| Barbershop | services | barber chairs, waiting bench, back sink |
| Nail Salon | services | manicure tables, pedicure chairs, polish wall |
| Day Spa | services | treatment rooms, sauna, relaxation lounge |
| Auto Repair Shop | services | service bays, lifts, parts room, waiting area |
| Car Wash | services | wash tunnel, vacuum stations, drying bay |
| Laundromat | services | washer rows, folding tables, change machine |
| Dry Cleaner | services | pressing station, garment conveyor, front counter |
| Tailor Shop | services | fitting room, sewing stations, fabric shelves |
| Locksmith Shop | services | key-cutting bench, lock displays, service van |
| Real Estate Agency | services | agent desks, meeting room, listings window |
| Law Firm | services | attorney offices, law library, conference room |
| Accounting Firm | services | accountant offices, records room, meeting room |
| Insurance Agency | services | agent desks, claims office, waiting area |
| Travel Agency | services | booking desks, brochure wall, poster displays |
| Photography Studio | services | shooting stage, lighting rigs, editing desk, prop closet |
| Tattoo Parlor | services | tattoo stations, sterilization room, flash-art walls |
| Funeral Home | services | chapel, viewing rooms, arrangement office |
| Cemetery | services | grave plots, chapel, groundskeeper shed |
| Pet Grooming Salon | services | grooming tables, wash tubs, drying stations |
| Courier Service | services | dispatch office, sorting depot, van fleet |
| Moving Company | services | truck bay, storage warehouse, office |
| Taxi Company | services | dispatch office, garage, driver lounge |
| Gas Station | services | fuel pumps, convenience shop, service bay |
| Employment Agency | services | interview rooms, agent desks, waiting area |
| IT Repair Shop | services | repair benches, parts drawers, front counter |
| Advertising Agency | services | creative studio, pitch room, corner offices |
| Cleaning Service | services | supply depot, dispatch office, van fleet |
| Notary Office | services | signing desk, records cabinet, waiting chairs |
| Hotel | hospitality | lobby, guest rooms, restaurant, housekeeping corridors |
| Motel | hospitality | front office, room row, parking lot |
| Hostel | hospitality | bunk dorms, common kitchen, luggage room |
| Bed and Breakfast | hospitality | guest rooms, breakfast room, garden |
| Resort | hospitality | lobby, pool deck, guest wings, activity center |
| Conference Center | hospitality | ballrooms, breakout rooms, AV booth, lobby |
| Farm | production/B2B | fields, barn, silo, farmhouse |
| Factory | production/B2B | assembly lines, machine floor, loading dock |
| Warehouse | production/B2B | racking aisles, forklift lanes, loading bays |
| Brewery | production/B2B | brewhouse, fermentation cellar, bottling line, taproom |
| Winery | production/B2B | vineyard, press house, barrel cellar, tasting room |
| Dairy Plant | production/B2B | pasteurization hall, bottling line, cold storage |
| Printing Press | production/B2B | press hall, prepress studio, paper store |
| Sawmill | production/B2B | log yard, saw line, drying kilns |
| Textile Mill | production/B2B | loom hall, dye room, cutting tables |
| Recycling Plant | production/B2B | sorting lines, baler bay, scale house |
| Furniture Workshop | production/B2B | woodshop, upholstery room, showroom |
| Slaughterhouse | production/B2B | processing floor, cold rooms, inspection station |
| City Hall | civic | council chamber, service counters, records office |
| Police Station | civic | front desk, briefing room, holding cells, evidence room |
| Fire Station | civic | engine bay, bunk room, watch office |
| Post Office | civic | service counters, sorting room, mail dock |
| Public Library | civic | reading rooms, stacks, children's corner, archive |
| Courthouse | civic | courtrooms, judge's chambers, records office |
| Water Treatment Plant | civic | filtration basins, pump hall, control room |
| Power Plant | civic | turbine hall, control room, switchyard |
| Bus Depot | civic | bus bays, maintenance pit, dispatch office |
| Train Station | civic | platforms, ticket hall, concourse |
| Community Center | civic | multipurpose hall, meeting rooms, kitchen |
| Church | civic | nave, altar, bell tower, parish office |
| Radio Station | civic | broadcast booth, control room, record library |
| Newspaper Office | civic | newsroom, editor's office, print archive |
| TV Station | civic | studio floor, control room, green room, editing bays |

---

## 2. Jobs per business

At least 4 positions per business. Job titles are intentionally shared across businesses (cashier, janitor, receptionist, the manager variants, ...) so the deduped catalog in section 3 stays compact and work Actions can be shared.

*Groceries*

### Supermarket

- Store Manager
- Cashier
- Stock Clerk
- Produce Clerk
- Butcher
- Janitor
- Security Guard

### Grocery Store

- Store Manager
- Cashier
- Stock Clerk
- Janitor

### Convenience Store

- Store Manager
- Cashier
- Stock Clerk
- Janitor

### Butcher Shop

- Butcher
- Cashier
- Store Manager
- Janitor

### Fish Market

- Fishmonger
- Cashier
- Store Manager
- Janitor

### Greengrocer

- Store Manager
- Cashier
- Produce Clerk
- Stock Clerk

### Delicatessen

- Deli Clerk
- Cashier
- Store Manager
- Janitor

### Cheese Shop

- Cheesemonger
- Cashier
- Store Manager
- Stock Clerk

### Liquor Store

- Store Manager
- Cashier
- Stock Clerk
- Security Guard

### Farmers' Market Hall

- Market Manager
- Stall Vendor
- Cashier
- Janitor
- Security Guard

*Dining*

### Restaurant

- Head Chef
- Line Cook
- Waiter
- Dishwasher
- Host
- Restaurant Manager

### Diner

- Line Cook
- Waiter
- Dishwasher
- Cashier
- Restaurant Manager

### Fast Food Joint

- Line Cook
- Cashier
- Shift Supervisor
- Janitor

### Pizzeria

- Pizzaiolo
- Waiter
- Cashier
- Delivery Driver
- Restaurant Manager

### Cafe

- Barista
- Waiter
- Pastry Chef
- Dishwasher
- Restaurant Manager

### Bakery

- Baker
- Pastry Chef
- Cashier
- Store Manager
- Janitor

### Ice Cream Parlor

- Counter Attendant
- Cashier
- Store Manager
- Janitor

### Sushi Bar

- Sushi Chef
- Waiter
- Dishwasher
- Host
- Restaurant Manager

### Steakhouse

- Head Chef
- Line Cook
- Waiter
- Sommelier
- Host
- Restaurant Manager

### Pub

- Bartender
- Line Cook
- Waiter
- Barback
- Bar Manager

### Tea House

- Tea Master
- Waiter
- Pastry Chef
- Cashier

### Juice Bar

- Counter Attendant
- Cashier
- Store Manager
- Janitor

### Cafeteria

- Line Cook
- Counter Attendant
- Cashier
- Dishwasher
- Janitor

### Buffet Restaurant

- Line Cook
- Counter Attendant
- Dishwasher
- Restaurant Manager
- Janitor

*Healthcare*

### Hospital

- Doctor
- Surgeon
- Nurse
- Orderly
- Receptionist
- Janitor

### Medical Clinic

- Doctor
- Nurse
- Receptionist
- Janitor

### Urgent Care Center

- Doctor
- Nurse
- Receptionist
- Orderly

### Dental Clinic

- Dentist
- Dental Hygienist
- Dental Assistant
- Receptionist

### Orthodontic Office

- Orthodontist
- Dental Assistant
- Receptionist
- Office Manager

### Pharmacy

- Pharmacist
- Pharmacy Technician
- Cashier
- Store Manager

### Optometry Practice

- Optometrist
- Optician
- Receptionist
- Sales Associate

### Veterinary Clinic

- Veterinarian
- Veterinary Technician
- Receptionist
- Kennel Attendant

### Physical Therapy Center

- Physical Therapist
- Massage Therapist
- Receptionist
- Office Manager

### Psychology Practice

- Psychologist
- Counselor
- Receptionist
- Office Manager

### Nursing Home

- Nurse
- Caregiver
- Line Cook
- Receptionist
- Janitor

### Medical Laboratory

- Lab Technician
- Phlebotomist
- Receptionist
- Courier

### Blood Donation Center

- Nurse
- Phlebotomist
- Receptionist
- Lab Technician

### Dermatology Clinic

- Doctor
- Nurse
- Receptionist
- Office Manager

*Education*

### Elementary School

- Teacher
- Principal
- Nurse
- Counter Attendant
- Janitor
- Groundskeeper

### High School

- Teacher
- Principal
- Counselor
- Librarian
- Coach
- Janitor

### Kindergarten

- Teacher
- Childcare Worker
- Principal
- Janitor

### Daycare Center

- Childcare Worker
- Teacher
- Receptionist
- Janitor

### University

- Professor
- Researcher
- Librarian
- Administrative Assistant
- Groundskeeper
- Janitor

### Trade School

- Instructor
- Administrative Assistant
- Receptionist
- Janitor

### Language School

- Instructor
- Receptionist
- Administrative Assistant
- Janitor

### Music School

- Music Teacher
- Receptionist
- Administrative Assistant
- Janitor

### Driving School

- Driving Instructor
- Receptionist
- Mechanic
- Administrative Assistant

### Tutoring Center

- Tutor
- Receptionist
- Administrative Assistant
- Office Manager

### Art School

- Art Teacher
- Receptionist
- Administrative Assistant
- Janitor

### Dance Academy

- Dance Instructor
- Receptionist
- Administrative Assistant
- Janitor

*Construction*

### Construction Company

- Construction Worker
- Foreman
- Crane Operator
- Civil Engineer
- Administrative Assistant

### Architecture Firm

- Architect
- Draftsman
- Office Manager
- Receptionist

### Plumbing Company

- Plumber
- Dispatcher
- Office Manager
- Administrative Assistant

### Electrical Contractor

- Electrician
- Dispatcher
- Office Manager
- Administrative Assistant

### Roofing Company

- Roofer
- Foreman
- Estimator
- Administrative Assistant

### Landscaping Company

- Landscaper
- Gardener
- Foreman
- Administrative Assistant

### Painting Contractor

- Painter
- Foreman
- Estimator
- Administrative Assistant

### Demolition Company

- Construction Worker
- Foreman
- Crane Operator
- Administrative Assistant

### Carpentry Workshop

- Carpenter
- Foreman
- Sales Associate
- Administrative Assistant

*Retail*

### Clothing Store

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk
- Tailor

### Shoe Store

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk

### Electronics Store

- Store Manager
- Cashier
- Sales Associate
- Repair Technician
- Stock Clerk

### Hardware Store

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk
- Locksmith

### Bookstore

- Store Manager
- Cashier
- Bookseller
- Stock Clerk

### Toy Store

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk

### Furniture Store

- Store Manager
- Sales Associate
- Cashier
- Delivery Driver
- Warehouse Worker

### Jewelry Store

- Store Manager
- Jeweler
- Sales Associate
- Security Guard

### Pet Store

- Store Manager
- Cashier
- Sales Associate
- Animal Caretaker

### Sporting Goods Store

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk

### Florist Shop

- Florist
- Cashier
- Delivery Driver
- Store Manager

### Music Store

- Store Manager
- Sales Associate
- Instrument Repair Technician
- Cashier

### Antique Shop

- Store Manager
- Appraiser
- Sales Associate
- Cashier

### Thrift Store

- Store Manager
- Cashier
- Stock Clerk
- Sales Associate

### Stationery Shop

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk

### Bicycle Shop

- Store Manager
- Bicycle Mechanic
- Sales Associate
- Cashier

### Garden Center

- Store Manager
- Gardener
- Cashier
- Sales Associate
- Stock Clerk

### Department Store

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk
- Security Guard
- Janitor

### Comic Book Shop

- Store Manager
- Cashier
- Sales Associate
- Stock Clerk

### Perfume Shop

- Store Manager
- Sales Associate
- Cashier
- Stock Clerk

### Mobile Phone Shop

- Store Manager
- Sales Associate
- Repair Technician
- Cashier

*Leisure*

### Gym

- Gym Manager
- Personal Trainer
- Fitness Instructor
- Receptionist
- Janitor

### Cinema

- Theater Manager
- Projectionist
- Ticket Agent
- Counter Attendant
- Usher
- Janitor

### Bowling Alley

- Counter Attendant
- Repair Technician
- Bartender
- Janitor

### Arcade

- Counter Attendant
- Repair Technician
- Cashier
- Janitor

### Museum

- Curator
- Archivist
- Tour Guide
- Ticket Agent
- Security Guard

### Art Gallery

- Curator
- Sales Associate
- Receptionist
- Security Guard

### Theater

- Actor
- Director
- Stage Manager
- Stagehand
- Costume Designer
- Ticket Agent
- Usher

### Public Swimming Pool

- Lifeguard
- Swim Instructor
- Ticket Agent
- Janitor

### Zoo

- Zookeeper
- Veterinarian
- Tour Guide
- Ticket Agent
- Groundskeeper

### Aquarium

- Aquarist
- Ticket Agent
- Tour Guide
- Janitor

### Casino

- Card Dealer
- Pit Boss
- Cashier
- Bartender
- Security Guard

### Nightclub

- DJ
- Bartender
- Barback
- Bouncer
- Bar Manager

### Bar

- Bartender
- Barback
- Waiter
- Bouncer
- Bar Manager

### Escape Room

- Game Master
- Receptionist
- Repair Technician
- Office Manager

### Mini Golf Course

- Ticket Agent
- Counter Attendant
- Groundskeeper
- Janitor

### Stadium

- Groundskeeper
- Ticket Agent
- Security Guard
- Usher
- Counter Attendant

### Concert Hall

- Musician
- Conductor
- Stage Manager
- Stagehand
- Usher
- Ticket Agent

### Ice Skating Rink

- Zamboni Driver
- Counter Attendant
- Coach
- Ticket Agent
- Janitor

### Yoga Studio

- Yoga Instructor
- Receptionist
- Office Manager
- Janitor

### Climbing Gym

- Climbing Instructor
- Route Setter
- Receptionist
- Counter Attendant
- Janitor

*Services*

### Bank

- Branch Manager
- Bank Teller
- Loan Officer
- Financial Advisor
- Security Guard
- Janitor

### Hair Salon

- Hairdresser
- Receptionist
- Cashier
- Janitor

### Barbershop

- Barber
- Receptionist
- Cashier
- Janitor

### Nail Salon

- Nail Technician
- Receptionist
- Cashier
- Janitor

### Day Spa

- Massage Therapist
- Esthetician
- Receptionist
- Office Manager
- Janitor

### Auto Repair Shop

- Mechanic
- Receptionist
- Stock Clerk
- Office Manager

### Car Wash

- Car Wash Attendant
- Detailer
- Cashier
- Janitor

### Laundromat

- Laundry Attendant
- Cashier
- Repair Technician
- Janitor

### Dry Cleaner

- Laundry Attendant
- Presser
- Counter Attendant
- Tailor

### Tailor Shop

- Tailor
- Seamstress
- Receptionist
- Cashier

### Locksmith Shop

- Locksmith
- Receptionist
- Cashier
- Office Manager

### Real Estate Agency

- Real Estate Agent
- Receptionist
- Office Manager
- Photographer

### Law Firm

- Lawyer
- Paralegal
- Administrative Assistant
- Receptionist
- Office Manager

### Accounting Firm

- Accountant
- Bookkeeper
- Auditor
- Receptionist
- Office Manager

### Insurance Agency

- Insurance Agent
- Claims Adjuster
- Receptionist
- Administrative Assistant

### Travel Agency

- Travel Agent
- Receptionist
- Office Manager
- Administrative Assistant

### Photography Studio

- Photographer
- Photo Editor
- Receptionist
- Office Manager

### Tattoo Parlor

- Tattoo Artist
- Piercer
- Receptionist
- Janitor

### Funeral Home

- Funeral Director
- Mortician
- Receptionist
- Janitor

### Cemetery

- Groundskeeper
- Gravedigger
- Stonemason
- Administrative Assistant

### Pet Grooming Salon

- Pet Groomer
- Receptionist
- Cashier
- Janitor

### Courier Service

- Courier
- Dispatcher
- Warehouse Worker
- Office Manager

### Moving Company

- Mover
- Truck Driver
- Dispatcher
- Office Manager

### Taxi Company

- Taxi Driver
- Dispatcher
- Mechanic
- Office Manager

### Gas Station

- Gas Station Attendant
- Cashier
- Mechanic
- Store Manager

### Employment Agency

- Recruiter
- Receptionist
- Office Manager
- Administrative Assistant

### IT Repair Shop

- Repair Technician
- Receptionist
- Cashier
- Store Manager

### Advertising Agency

- Creative Director
- Copywriter
- Graphic Designer
- Account Manager
- Receptionist

### Cleaning Service

- Cleaner
- Dispatcher
- Office Manager
- Administrative Assistant

### Notary Office

- Notary
- Receptionist
- Administrative Assistant
- Office Manager

*Hospitality*

### Hotel

- Hotel Manager
- Concierge
- Receptionist
- Housekeeper
- Bellhop
- Line Cook
- Maintenance Worker

### Motel

- Hotel Manager
- Receptionist
- Housekeeper
- Maintenance Worker

### Hostel

- Receptionist
- Housekeeper
- Janitor
- Hotel Manager

### Bed and Breakfast

- Innkeeper
- Housekeeper
- Line Cook
- Gardener

### Resort

- Hotel Manager
- Concierge
- Housekeeper
- Lifeguard
- Bartender
- Activities Coordinator

### Conference Center

- Event Coordinator
- Receptionist
- Maintenance Worker
- Janitor

*Production / B2B*

### Farm

- Farmer
- Farmhand
- Mechanic
- Truck Driver

### Factory

- Assembly Line Worker
- Machine Operator
- Quality Inspector
- Foreman
- Forklift Operator
- Maintenance Worker

### Warehouse

- Warehouse Worker
- Forklift Operator
- Dispatcher
- Foreman

### Brewery

- Brewmaster
- Brewer
- Assembly Line Worker
- Quality Inspector
- Truck Driver

### Winery

- Winemaker
- Farmhand
- Sommelier
- Tour Guide

### Dairy Plant

- Machine Operator
- Quality Inspector
- Truck Driver
- Maintenance Worker

### Printing Press

- Machine Operator
- Graphic Designer
- Delivery Driver
- Foreman

### Sawmill

- Sawyer
- Machine Operator
- Forklift Operator
- Foreman

### Textile Mill

- Machine Operator
- Seamstress
- Quality Inspector
- Foreman

### Recycling Plant

- Assembly Line Worker
- Machine Operator
- Truck Driver
- Foreman

### Furniture Workshop

- Carpenter
- Upholsterer
- Sales Associate
- Delivery Driver

### Slaughterhouse

- Butcher
- Machine Operator
- Quality Inspector
- Foreman

*Civic*

### City Hall

- Mayor
- City Clerk
- Urban Planner
- Administrative Assistant
- Receptionist
- Janitor

### Police Station

- Police Officer
- Detective
- Dispatcher
- Janitor

### Fire Station

- Firefighter
- Fire Chief
- Paramedic
- Dispatcher

### Post Office

- Mail Carrier
- Postal Clerk
- Truck Driver
- Office Manager

### Public Library

- Librarian
- Library Assistant
- Archivist
- Janitor

### Courthouse

- Judge
- Bailiff
- Court Clerk
- Lawyer
- Janitor

### Water Treatment Plant

- Machine Operator
- Lab Technician
- Maintenance Worker
- Civil Engineer

### Power Plant

- Machine Operator
- Electrician
- Maintenance Worker
- Civil Engineer

### Bus Depot

- Bus Driver
- Mechanic
- Dispatcher
- Janitor

### Train Station

- Ticket Agent
- Train Conductor
- Security Guard
- Janitor

### Community Center

- Event Coordinator
- Activities Coordinator
- Receptionist
- Janitor

### Church

- Priest
- Musician
- Administrative Assistant
- Groundskeeper
- Janitor

### Radio Station

- Radio Host
- Sound Engineer
- Journalist
- Receptionist

### Newspaper Office

- Journalist
- Editor
- Photographer
- Administrative Assistant

### TV Station

- News Anchor
- Camera Operator
- Journalist
- Sound Engineer
- Editor

---

## 3. Deduped job-title catalog

213 distinct job titles across 163 businesses (720 total entries).

| job title | businesses that use it (sample) | count of businesses |
| --- | --- | --- |
| Account Manager | Advertising Agency | 1 |
| Accountant | Accounting Firm | 1 |
| Activities Coordinator | Resort, Community Center | 2 |
| Actor | Theater | 1 |
| Administrative Assistant | University, Trade School, Language School, Music School, Driving School, Tutoring Center, +20 more | 26 |
| Animal Caretaker | Pet Store | 1 |
| Appraiser | Antique Shop | 1 |
| Aquarist | Aquarium | 1 |
| Architect | Architecture Firm | 1 |
| Archivist | Museum, Public Library | 2 |
| Art Teacher | Art School | 1 |
| Assembly Line Worker | Factory, Brewery, Recycling Plant | 3 |
| Auditor | Accounting Firm | 1 |
| Bailiff | Courthouse | 1 |
| Baker | Bakery | 1 |
| Bank Teller | Bank | 1 |
| Bar Manager | Pub, Nightclub, Bar | 3 |
| Barback | Pub, Nightclub, Bar | 3 |
| Barber | Barbershop | 1 |
| Barista | Cafe | 1 |
| Bartender | Pub, Bowling Alley, Casino, Nightclub, Bar, Resort | 6 |
| Bellhop | Hotel | 1 |
| Bicycle Mechanic | Bicycle Shop | 1 |
| Bookkeeper | Accounting Firm | 1 |
| Bookseller | Bookstore | 1 |
| Bouncer | Nightclub, Bar | 2 |
| Branch Manager | Bank | 1 |
| Brewer | Brewery | 1 |
| Brewmaster | Brewery | 1 |
| Bus Driver | Bus Depot | 1 |
| Butcher | Supermarket, Butcher Shop, Slaughterhouse | 3 |
| Camera Operator | TV Station | 1 |
| Car Wash Attendant | Car Wash | 1 |
| Card Dealer | Casino | 1 |
| Caregiver | Nursing Home | 1 |
| Carpenter | Carpentry Workshop, Furniture Workshop | 2 |
| Cashier | Supermarket, Grocery Store, Convenience Store, Butcher Shop, Fish Market, Greengrocer, +45 more | 51 |
| Cheesemonger | Cheese Shop | 1 |
| Childcare Worker | Kindergarten, Daycare Center | 2 |
| City Clerk | City Hall | 1 |
| Civil Engineer | Construction Company, Water Treatment Plant, Power Plant | 3 |
| Claims Adjuster | Insurance Agency | 1 |
| Cleaner | Cleaning Service | 1 |
| Climbing Instructor | Climbing Gym | 1 |
| Coach | High School, Ice Skating Rink | 2 |
| Concierge | Hotel, Resort | 2 |
| Conductor | Concert Hall | 1 |
| Construction Worker | Construction Company, Demolition Company | 2 |
| Copywriter | Advertising Agency | 1 |
| Costume Designer | Theater | 1 |
| Counselor | Psychology Practice, High School | 2 |
| Counter Attendant | Ice Cream Parlor, Juice Bar, Cafeteria, Buffet Restaurant, Elementary School, Cinema, +7 more | 13 |
| Courier | Medical Laboratory, Courier Service | 2 |
| Court Clerk | Courthouse | 1 |
| Crane Operator | Construction Company, Demolition Company | 2 |
| Creative Director | Advertising Agency | 1 |
| Curator | Museum, Art Gallery | 2 |
| DJ | Nightclub | 1 |
| Dance Instructor | Dance Academy | 1 |
| Deli Clerk | Delicatessen | 1 |
| Delivery Driver | Pizzeria, Furniture Store, Florist Shop, Printing Press, Furniture Workshop | 5 |
| Dental Assistant | Dental Clinic, Orthodontic Office | 2 |
| Dental Hygienist | Dental Clinic | 1 |
| Dentist | Dental Clinic | 1 |
| Detailer | Car Wash | 1 |
| Detective | Police Station | 1 |
| Director | Theater | 1 |
| Dishwasher | Restaurant, Diner, Cafe, Sushi Bar, Cafeteria, Buffet Restaurant | 6 |
| Dispatcher | Plumbing Company, Electrical Contractor, Courier Service, Moving Company, Taxi Company, Cleaning Service, +4 more | 10 |
| Doctor | Hospital, Medical Clinic, Urgent Care Center, Dermatology Clinic | 4 |
| Draftsman | Architecture Firm | 1 |
| Driving Instructor | Driving School | 1 |
| Editor | Newspaper Office, TV Station | 2 |
| Electrician | Electrical Contractor, Power Plant | 2 |
| Esthetician | Day Spa | 1 |
| Estimator | Roofing Company, Painting Contractor | 2 |
| Event Coordinator | Conference Center, Community Center | 2 |
| Farmer | Farm | 1 |
| Farmhand | Farm, Winery | 2 |
| Financial Advisor | Bank | 1 |
| Fire Chief | Fire Station | 1 |
| Firefighter | Fire Station | 1 |
| Fishmonger | Fish Market | 1 |
| Fitness Instructor | Gym | 1 |
| Florist | Florist Shop | 1 |
| Foreman | Construction Company, Roofing Company, Landscaping Company, Painting Contractor, Demolition Company, Carpentry Workshop, +7 more | 13 |
| Forklift Operator | Factory, Warehouse, Sawmill | 3 |
| Funeral Director | Funeral Home | 1 |
| Game Master | Escape Room | 1 |
| Gardener | Landscaping Company, Garden Center, Bed and Breakfast | 3 |
| Gas Station Attendant | Gas Station | 1 |
| Graphic Designer | Advertising Agency, Printing Press | 2 |
| Gravedigger | Cemetery | 1 |
| Groundskeeper | Elementary School, University, Zoo, Mini Golf Course, Stadium, Cemetery, +1 more | 7 |
| Gym Manager | Gym | 1 |
| Hairdresser | Hair Salon | 1 |
| Head Chef | Restaurant, Steakhouse | 2 |
| Host | Restaurant, Sushi Bar, Steakhouse | 3 |
| Hotel Manager | Hotel, Motel, Hostel, Resort | 4 |
| Housekeeper | Hotel, Motel, Hostel, Bed and Breakfast, Resort | 5 |
| Innkeeper | Bed and Breakfast | 1 |
| Instructor | Trade School, Language School | 2 |
| Instrument Repair Technician | Music Store | 1 |
| Insurance Agent | Insurance Agency | 1 |
| Janitor | Supermarket, Grocery Store, Convenience Store, Butcher Shop, Fish Market, Delicatessen, +51 more | 57 |
| Jeweler | Jewelry Store | 1 |
| Journalist | Radio Station, Newspaper Office, TV Station | 3 |
| Judge | Courthouse | 1 |
| Kennel Attendant | Veterinary Clinic | 1 |
| Lab Technician | Medical Laboratory, Blood Donation Center, Water Treatment Plant | 3 |
| Landscaper | Landscaping Company | 1 |
| Laundry Attendant | Laundromat, Dry Cleaner | 2 |
| Lawyer | Law Firm, Courthouse | 2 |
| Librarian | High School, University, Public Library | 3 |
| Library Assistant | Public Library | 1 |
| Lifeguard | Public Swimming Pool, Resort | 2 |
| Line Cook | Restaurant, Diner, Fast Food Joint, Steakhouse, Pub, Cafeteria, +4 more | 10 |
| Loan Officer | Bank | 1 |
| Locksmith | Hardware Store, Locksmith Shop | 2 |
| Machine Operator | Factory, Dairy Plant, Printing Press, Sawmill, Textile Mill, Recycling Plant, +3 more | 9 |
| Mail Carrier | Post Office | 1 |
| Maintenance Worker | Hotel, Motel, Conference Center, Factory, Dairy Plant, Water Treatment Plant, +1 more | 7 |
| Market Manager | Farmers' Market Hall | 1 |
| Massage Therapist | Physical Therapy Center, Day Spa | 2 |
| Mayor | City Hall | 1 |
| Mechanic | Driving School, Auto Repair Shop, Taxi Company, Gas Station, Farm, Bus Depot | 6 |
| Mortician | Funeral Home | 1 |
| Mover | Moving Company | 1 |
| Music Teacher | Music School | 1 |
| Musician | Concert Hall, Church | 2 |
| Nail Technician | Nail Salon | 1 |
| News Anchor | TV Station | 1 |
| Notary | Notary Office | 1 |
| Nurse | Hospital, Medical Clinic, Urgent Care Center, Nursing Home, Blood Donation Center, Dermatology Clinic, +1 more | 7 |
| Office Manager | Orthodontic Office, Physical Therapy Center, Psychology Practice, Dermatology Clinic, Tutoring Center, Architecture Firm, +19 more | 25 |
| Optician | Optometry Practice | 1 |
| Optometrist | Optometry Practice | 1 |
| Orderly | Hospital, Urgent Care Center | 2 |
| Orthodontist | Orthodontic Office | 1 |
| Painter | Painting Contractor | 1 |
| Paralegal | Law Firm | 1 |
| Paramedic | Fire Station | 1 |
| Pastry Chef | Cafe, Bakery, Tea House | 3 |
| Personal Trainer | Gym | 1 |
| Pet Groomer | Pet Grooming Salon | 1 |
| Pharmacist | Pharmacy | 1 |
| Pharmacy Technician | Pharmacy | 1 |
| Phlebotomist | Medical Laboratory, Blood Donation Center | 2 |
| Photo Editor | Photography Studio | 1 |
| Photographer | Real Estate Agency, Photography Studio, Newspaper Office | 3 |
| Physical Therapist | Physical Therapy Center | 1 |
| Piercer | Tattoo Parlor | 1 |
| Pit Boss | Casino | 1 |
| Pizzaiolo | Pizzeria | 1 |
| Plumber | Plumbing Company | 1 |
| Police Officer | Police Station | 1 |
| Postal Clerk | Post Office | 1 |
| Presser | Dry Cleaner | 1 |
| Priest | Church | 1 |
| Principal | Elementary School, High School, Kindergarten | 3 |
| Produce Clerk | Supermarket, Greengrocer | 2 |
| Professor | University | 1 |
| Projectionist | Cinema | 1 |
| Psychologist | Psychology Practice | 1 |
| Quality Inspector | Factory, Brewery, Dairy Plant, Textile Mill, Slaughterhouse | 5 |
| Radio Host | Radio Station | 1 |
| Real Estate Agent | Real Estate Agency | 1 |
| Receptionist | Hospital, Medical Clinic, Urgent Care Center, Dental Clinic, Orthodontic Office, Optometry Practice, +48 more | 54 |
| Recruiter | Employment Agency | 1 |
| Repair Technician | Electronics Store, Mobile Phone Shop, Bowling Alley, Arcade, Escape Room, Laundromat, +1 more | 7 |
| Researcher | University | 1 |
| Restaurant Manager | Restaurant, Diner, Pizzeria, Cafe, Sushi Bar, Steakhouse, +1 more | 7 |
| Roofer | Roofing Company | 1 |
| Route Setter | Climbing Gym | 1 |
| Sales Associate | Optometry Practice, Carpentry Workshop, Clothing Store, Shoe Store, Electronics Store, Hardware Store, +17 more | 23 |
| Sawyer | Sawmill | 1 |
| Seamstress | Tailor Shop, Textile Mill | 2 |
| Security Guard | Supermarket, Liquor Store, Farmers' Market Hall, Jewelry Store, Department Store, Museum, +5 more | 11 |
| Shift Supervisor | Fast Food Joint | 1 |
| Sommelier | Steakhouse, Winery | 2 |
| Sound Engineer | Radio Station, TV Station | 2 |
| Stage Manager | Theater, Concert Hall | 2 |
| Stagehand | Theater, Concert Hall | 2 |
| Stall Vendor | Farmers' Market Hall | 1 |
| Stock Clerk | Supermarket, Grocery Store, Convenience Store, Greengrocer, Cheese Shop, Liquor Store, +14 more | 20 |
| Stonemason | Cemetery | 1 |
| Store Manager | Supermarket, Grocery Store, Convenience Store, Butcher Shop, Fish Market, Greengrocer, +30 more | 36 |
| Surgeon | Hospital | 1 |
| Sushi Chef | Sushi Bar | 1 |
| Swim Instructor | Public Swimming Pool | 1 |
| Tailor | Clothing Store, Dry Cleaner, Tailor Shop | 3 |
| Tattoo Artist | Tattoo Parlor | 1 |
| Taxi Driver | Taxi Company | 1 |
| Tea Master | Tea House | 1 |
| Teacher | Elementary School, High School, Kindergarten, Daycare Center | 4 |
| Theater Manager | Cinema | 1 |
| Ticket Agent | Cinema, Museum, Theater, Public Swimming Pool, Zoo, Aquarium, +5 more | 11 |
| Tour Guide | Museum, Zoo, Aquarium, Winery | 4 |
| Train Conductor | Train Station | 1 |
| Travel Agent | Travel Agency | 1 |
| Truck Driver | Moving Company, Farm, Brewery, Dairy Plant, Recycling Plant, Post Office | 6 |
| Tutor | Tutoring Center | 1 |
| Upholsterer | Furniture Workshop | 1 |
| Urban Planner | City Hall | 1 |
| Usher | Cinema, Theater, Stadium, Concert Hall | 4 |
| Veterinarian | Veterinary Clinic, Zoo | 2 |
| Veterinary Technician | Veterinary Clinic | 1 |
| Waiter | Restaurant, Diner, Pizzeria, Cafe, Sushi Bar, Steakhouse, +3 more | 9 |
| Warehouse Worker | Furniture Store, Courier Service, Warehouse | 3 |
| Winemaker | Winery | 1 |
| Yoga Instructor | Yoga Studio | 1 |
| Zamboni Driver | Ice Skating Rink | 1 |
| Zookeeper | Zoo | 1 |
