# Events Master List

**Purpose.** This is the content-planning master list of life **events** for TownBox's event engine (Engine B, `src/json/events.json`) as it grows alongside the planned **Actions** system. Events are things that *happen to or about* a person and get logged in their life history; Actions are things people *do*. Each row names a candidate event (written as a past-tense life-log line, matching the existing `label` style: "Passed away", "Got married"), its snake_case id slug, how it can be triggered — **probabilistic** (rolled per tick by the event engine) and/or **manual** (fired by code: an Action's completion/outcome, a system rule, or another event's signal — this tag also covers "automated" system triggers) — its life-domain category, and, for manually triggerable events, the plausible triggering Action or system. Many events are deliberately dual-trigger: they can both occur spontaneously via a probability roll and be forced by an Action or system. This list is planning material, not a schema; names, categories, and sources are expected to be refined as events are actually authored into `events.json`.

**Counts** (verified by script over the table rows):

- Total unique events: **680**
- Tagged probabilistic: **531**
- Tagged manual: **518**
- Tagged both: **369** (probabilistic-only: 162, manual-only: 149)

**Category distribution** (24 categories):

| Category | Events | | Category | Events | | Category | Events |
| --- | ---: | --- | --- | ---: | --- | --- | ---: |
| career | 35 | | childhood | 30 | | crime-mischief | 28 |
| health | 30 | | travel | 28 | | emotion-mood | 28 |
| romance | 30 | | possessions | 28 | | weather-reaction | 25 |
| family | 30 | | pet | 28 | | milestone | 25 |
| education | 30 | | housing | 28 | | legal | 25 |
| finance | 30 | | food | 28 | | death | 25 |
| social | 30 | | community | 28 | | achievement | 25 |
| hobby | 30 | | aging | 28 | | accident | 28 |

## Master table

| Event | Slug | Trigger types | Category | Likely action/system source |
| --- | --- | --- | --- | --- |
| Caught a cold | caught_cold | probabilistic, manual | health | Weather system (season tick) |
| Caught the flu | caught_flu | probabilistic, manual | health | Weather system (season tick) |
| Recovered from an illness | recovered_from_illness | probabilistic, manual | health | Illness recovery system |
| Sprained an ankle | sprained_ankle | probabilistic, manual | health | Exercise action |
| Got a migraine | got_migraine | probabilistic, manual | health | Stress rule |
| Pulled a muscle | pulled_muscle | manual | health | Exercise action |
| Had a routine checkup | had_routine_checkup | probabilistic, manual | health | Clinic visit action |
| Got vaccinated | got_vaccinated | probabilistic, manual | health | Clinic visit action |
| Was diagnosed with a chronic illness | diagnosed_chronic_illness | probabilistic | health | - |
| Started wearing glasses | started_wearing_glasses | probabilistic, manual | health | Optometrist visit action |
| Had surgery | had_surgery | probabilistic, manual | health | Hospital admission system |
| Was hospitalized | was_hospitalized | probabilistic, manual | health | Health crisis system |
| Donated blood | donated_blood | probabilistic, manual | health | Clinic visit action |
| Broke a fever | broke_fever | manual | health | Illness recovery system |
| Had an allergic reaction | had_allergic_reaction | probabilistic, manual | health | Eating action |
| Developed insomnia | developed_insomnia | probabilistic, manual | health | Stress rule |
| Slept through the night again | slept_through_night_again | probabilistic | health | - |
| Threw out their back | threw_out_back | probabilistic, manual | health | Furniture-moving action |
| Got food poisoning | got_food_poisoning | probabilistic, manual | health | Dining action mishap |
| Quit smoking | quit_smoking | probabilistic, manual | health | Resolution action |
| Took up smoking | took_up_smoking | probabilistic | health | - |
| Started a fitness routine | started_fitness_routine | probabilistic, manual | health | Gym visit action |
| Lost weight | lost_weight | probabilistic, manual | health | Gym action streak |
| Gained weight | gained_weight | probabilistic, manual | health | Eating action streak |
| Had a panic attack | had_panic_attack | probabilistic, manual | health | Stress rule |
| Fainted | fainted | probabilistic, manual | health | Overexertion rule |
| Got a filling at the dentist | got_dental_filling | probabilistic, manual | health | Dentist visit action |
| Had a toothache | had_toothache | probabilistic, manual | health | Sweets action streak |
| Beat a long illness | beat_long_illness | probabilistic | health | - |
| Got a clean bill of health | got_clean_bill_of_health | manual | health | Checkup action outcome |
| Had a first kiss | had_first_kiss | probabilistic, manual | romance | Date action |
| Went on a first date | went_on_first_date | probabilistic, manual | romance | Date action |
| Developed a crush | developed_crush | probabilistic, manual | romance | Social interaction action |
| Asked someone out | asked_someone_out | probabilistic, manual | romance | Social interaction action |
| Was turned down | was_turned_down | probabilistic, manual | romance | Date action outcome |
| Started dating | started_dating | probabilistic, manual | romance | Relationship system |
| Made it official | made_it_official | probabilistic, manual | romance | Relationship system |
| Got engaged | got_engaged | probabilistic, manual | romance | Proposal action |
| Proposed and was rejected | proposal_rejected | manual | romance | Proposal action outcome |
| Got married | got_married | probabilistic, manual | romance | Wedding system (marriage event) |
| Eloped | eloped | probabilistic, manual | romance | Proposal action |
| Had a wedding anniversary | had_wedding_anniversary | manual | romance | Calendar system |
| Renewed their vows | renewed_vows | probabilistic | romance | - |
| Had a big argument with partner | argued_with_partner | probabilistic, manual | romance | Household friction rule |
| Reconciled with partner | reconciled_with_partner | probabilistic, manual | romance | Reconciliation action |
| Went through a rough patch | went_through_rough_patch | probabilistic | romance | - |
| Was cheated on | was_cheated_on | manual | romance | Affair event signal |
| Had an affair | had_affair | probabilistic | romance | - |
| Ended an affair | ended_affair | probabilistic, manual | romance | Affair event chain |
| Got divorced | got_divorced | probabilistic, manual | romance | Divorce system (divorce event) |
| Broke up | broke_up | probabilistic, manual | romance | Relationship system |
| Got back together | got_back_together | probabilistic, manual | romance | Reconciliation action |
| Moved in with partner | moved_in_with_partner | manual | romance | Cohabitation handler (task 023) |
| Had a candlelit dinner | had_candlelit_dinner | probabilistic, manual | romance | Dining action |
| Received a love letter | received_love_letter | probabilistic, manual | romance | Mail system |
| Wrote a love letter | wrote_love_letter | probabilistic, manual | romance | Writing action |
| Had a date night | had_date_night | probabilistic, manual | romance | Date action |
| Fell in love | fell_in_love | probabilistic, manual | romance | Date action streak |
| Fell out of love | fell_out_of_love | probabilistic | romance | - |
| Met a charming stranger | met_charming_stranger | probabilistic, manual | romance | Street encounter system |
| Became pregnant | became_pregnant | probabilistic, manual | family | Pregnancy system (pregnancy event) |
| Gave birth | gave_birth | manual | family | Birth system |
| Became a parent | became_parent | manual | family | Birth system signal |
| Suffered a miscarriage | had_miscarriage | probabilistic | family | - |
| Adopted a child | adopted_child | probabilistic, manual | family | Adoption agency system |
| Welcomed a sibling | welcomed_sibling | manual | family | Birth system signal |
| Named the baby | named_baby | manual | family | Birth system |
| Hosted a family reunion | hosted_family_reunion | probabilistic, manual | family | Social gathering action |
| Argued with a sibling | argued_with_sibling | probabilistic, manual | family | Household friction rule |
| Reconciled with a sibling | reconciled_with_sibling | probabilistic, manual | family | Reconciliation action |
| Took in an aging parent | took_in_aging_parent | manual | family | Rehousing system |
| Was taken in by relatives | taken_in_by_relatives | manual | family | Rehousing system (tasks 011/022) |
| Became estranged from family | became_estranged | probabilistic | family | - |
| Reconnected with an estranged relative | reconnected_with_relative | probabilistic | family | - |
| Taught a child to ride a bike | taught_child_to_ride_bike | probabilistic, manual | family | Parenting action |
| Read a bedtime story | read_bedtime_story | probabilistic, manual | family | Parenting action |
| Grounded a child | grounded_child | probabilistic, manual | family | Parenting rule |
| Was grounded | was_grounded | manual | family | Parenting rule |
| Had "the talk" with a child | had_the_talk | probabilistic | family | - |
| Celebrated a child's birthday | celebrated_childs_birthday | manual | family | Calendar system |
| Enrolled a child in school | enrolled_child_in_school | manual | family | School enrollment system |
| Watched a child graduate | watched_child_graduate | manual | family | Education system signal |
| Walked a child down the aisle | walked_child_down_aisle | manual | family | Wedding system |
| Became an aunt or uncle | became_aunt_or_uncle | manual | family | Birth system signal |
| Met a new in-law | met_new_in_law | manual | family | Marriage system signal |
| Inherited a family heirloom | inherited_heirloom | manual | family | Estate system |
| Started a family tradition | started_family_tradition | probabilistic | family | - |
| Had a family game night | had_family_game_night | probabilistic, manual | family | Leisure action |
| Was scolded by parents | was_scolded | probabilistic, manual | family | Parenting rule |
| Helped a child with homework | helped_with_homework | probabilistic, manual | family | Parenting action |
| Passed away | passed_away | probabilistic, manual | death | Health crisis system (death event) |
| Died in an accident | died_in_accident | manual | death | Accident system |
| Died peacefully in their sleep | died_in_sleep | probabilistic | death | - |
| Lost a spouse | lost_spouse | manual | death | Death event signal |
| Lost a parent | lost_parent | manual | death | Death event signal |
| Lost a child | lost_child | manual | death | Death event signal |
| Lost a close friend | lost_close_friend | manual | death | Death event signal |
| Attended a funeral | attended_funeral | manual | death | Funeral gathering system |
| Delivered a eulogy | delivered_eulogy | manual | death | Funeral gathering system |
| Wrote a will | wrote_will | probabilistic, manual | death | Paperwork action |
| Updated their will | updated_will | probabilistic, manual | death | Paperwork action |
| Inherited an estate | inherited_estate | manual | death | Estate system |
| Was named in a will | named_in_will | manual | death | Estate system |
| Had a near-death experience | had_near_death_experience | probabilistic, manual | death | Accident system |
| Survived a heart attack | survived_heart_attack | probabilistic, manual | death | Health crisis system |
| Had a health scare | had_health_scare | probabilistic, manual | death | Checkup action outcome |
| Made peace with an old rival | made_peace_with_rival | probabilistic | death | - |
| Planned their own funeral | planned_own_funeral | probabilistic | death | - |
| Visited a grave | visited_grave | probabilistic, manual | death | Cemetery visit action |
| Mourned the anniversary of a loss | mourned_loss_anniversary | manual | death | Calendar system |
| Became widowed | became_widowed | manual | death | Death event signal |
| Scattered a loved one's ashes | scattered_ashes | manual | death | Memorial action |
| Received a terminal diagnosis | received_terminal_diagnosis | probabilistic, manual | death | Hospital system |
| Outlived the doctor's prognosis | outlived_prognosis | probabilistic | death | - |
| Said final goodbyes | said_final_goodbyes | manual | death | Hospice system |
| Got a job | got_job | probabilistic, manual | career | JobMarket hire (get_job event) |
| Started a new job | started_new_job | manual | career | JobMarket hire signal |
| Had a first day at work | had_first_day_at_work | manual | career | Work action (first shift) |
| Got promoted | got_promoted | probabilistic, manual | career | Job Orchestrator |
| Got demoted | got_demoted | probabilistic, manual | career | Job Orchestrator |
| Got a raise | got_raise | probabilistic, manual | career | Economy monthly tick |
| Was passed over for a promotion | passed_over_for_promotion | manual | career | Job Orchestrator |
| Was laid off | was_laid_off | probabilistic, manual | career | Bankruptcy/downsizing system (layoff event) |
| Was fired | was_fired | probabilistic, manual | career | Workplace discipline rule |
| Quit their job | quit_job | probabilistic, manual | career | Job Orchestrator |
| Rage-quit on the spot | rage_quit | probabilistic | career | - |
| Retired | retired | probabilistic, manual | career | Retirement system (retirement event) |
| Came out of retirement | came_out_of_retirement | probabilistic | career | - |
| Went to work | went_to_work | manual | career | Commute arrival |
| Finished a shift | finished_shift | manual | career | Shift-end rule |
| Worked overtime | worked_overtime | probabilistic, manual | career | Work action completion |
| Called in sick | called_in_sick | probabilistic, manual | career | Illness system |
| Was late for work | late_for_work | probabilistic, manual | career | Oversleep rule / commute delay |
| Was named employee of the month | employee_of_the_month | manual | career | Workplace monthly review |
| Botched a big project | botched_big_project | probabilistic, manual | career | Work action outcome |
| Nailed a big presentation | nailed_presentation | probabilistic, manual | career | Work action outcome |
| Got a new boss | got_new_boss | manual | career | Business staffing system |
| Trained a new coworker | trained_new_coworker | probabilistic, manual | career | JobMarket hire signal |
| Had a workplace argument | argued_with_coworker | probabilistic, manual | career | Work action friction |
| Made a work friend | made_work_friend | probabilistic, manual | career | Work action socializing |
| Was headhunted | was_headhunted | probabilistic | career | - |
| Turned down a job offer | turned_down_job_offer | probabilistic, manual | career | JobMarket offer |
| Started a side hustle | started_side_hustle | probabilistic, manual | career | Entrepreneur action |
| Folded the side hustle | folded_side_hustle | probabilistic, manual | career | Economy monthly tick |
| Burned out | burned_out | probabilistic, manual | career | Workload rule |
| Recovered from burnout | recovered_from_burnout | probabilistic | career | - |
| Took a sabbatical | took_sabbatical | probabilistic | career | - |
| Switched careers | switched_careers | probabilistic, manual | career | JobMarket rehire |
| Was injured at work | injured_at_work | probabilistic, manual | career | Work action mishap |
| Celebrated a work anniversary | celebrated_work_anniversary | manual | career | Calendar system |
| Started school | started_school | manual | education | School enrollment system |
| Had a first day of school | first_day_of_school | manual | education | School attendance action |
| Learned to read | learned_to_read | probabilistic, manual | education | School attendance action |
| Learned to write | learned_to_write | manual | education | School attendance action |
| Passed an exam | passed_exam | probabilistic, manual | education | Exam system |
| Failed an exam | failed_exam | probabilistic, manual | education | Exam system |
| Aced a final | aced_final | probabilistic, manual | education | Exam system |
| Pulled an all-nighter studying | pulled_all_nighter | probabilistic, manual | education | Study action |
| Was caught cheating on a test | caught_cheating_on_test | probabilistic, manual | education | Exam system |
| Won the spelling bee | won_spelling_bee | probabilistic, manual | education | School contest system |
| Made the honor roll | made_honor_roll | manual | education | School term system |
| Was held back a year | held_back_a_year | probabilistic | education | - |
| Skipped a grade | skipped_grade | probabilistic | education | - |
| Graduated school | graduated_school | probabilistic, manual | education | Education system |
| Dropped out of school | dropped_out | probabilistic, manual | education | School term system |
| Went back to school | went_back_to_school | probabilistic | education | - |
| Enrolled in trade school | enrolled_in_trade_school | probabilistic, manual | education | Education system (trade_school event) |
| Graduated nursing school | graduated_nursing_school | probabilistic, manual | education | Education system (nursing_school event) |
| Learned a new skill | learned_new_skill | probabilistic, manual | education | SkillRegistry (acquireSkill effect) |
| Got a scholarship | got_scholarship | probabilistic, manual | education | School term system |
| Gave the valedictorian speech | gave_valedictorian_speech | manual | education | Graduation system |
| Joined the debate club | joined_debate_club | probabilistic | education | - |
| Won the science fair | won_science_fair | probabilistic, manual | education | School contest system |
| Got detention | got_detention | probabilistic, manual | education | School discipline rule |
| Skipped class | skipped_class | probabilistic, manual | education | School attendance rule |
| Saw a favorite teacher retire | favorite_teacher_retired | manual | education | Retirement event signal |
| Finished an apprenticeship | finished_apprenticeship | probabilistic, manual | education | Education system |
| Took an evening course | took_evening_course | probabilistic, manual | education | Study action |
| Earned a certificate | earned_certificate | probabilistic, manual | education | Study action completion |
| Blanked on a test | blanked_on_test | probabilistic | education | - |
| Got paid | got_paid | manual | finance | Wage system (task 018) |
| Missed a paycheck | missed_paycheck | manual | finance | Payroll failure (insolvent employer) |
| Paid the bills | paid_bills | manual | finance | Cost-of-living tick (task 019) |
| Fell into arrears | fell_into_arrears | manual | finance | Cost-of-living tick (task 019) |
| Cleared their arrears | cleared_arrears | manual | finance | Recovery system (task 022) |
| Received an inheritance | received_inheritance | manual | finance | Estate system |
| Won the lottery | won_lottery | probabilistic, manual | finance | Lottery ticket action |
| Won a raffle | won_raffle | probabilistic, manual | finance | Community fair system |
| Found money on the street | found_money_on_street | probabilistic | finance | - |
| Lost their wallet | lost_wallet | probabilistic, manual | finance | Commute mishap rule |
| Had their wallet returned | wallet_returned | probabilistic | finance | - |
| Started a savings jar | started_savings_jar | probabilistic | finance | - |
| Blew their savings | blew_savings | probabilistic, manual | finance | Shopping action spree |
| Made a risky investment | made_risky_investment | probabilistic, manual | finance | Bank visit action |
| Saw an investment pay off | investment_paid_off | probabilistic, manual | finance | Economy monthly tick |
| Saw an investment go bust | investment_went_bust | probabilistic, manual | finance | Economy monthly tick |
| Took out a loan | took_out_loan | probabilistic, manual | finance | Bank visit action |
| Paid off a loan | paid_off_loan | manual | finance | Loan system tick |
| Defaulted on a loan | defaulted_on_loan | manual | finance | Loan system tick |
| Went bankrupt | went_bankrupt | manual | finance | Bankruptcy system (task 021) |
| Opened a bank account | opened_bank_account | manual | finance | Bank visit action |
| Got a tax refund | got_tax_refund | manual | finance | Tax system (yearly) |
| Was audited | was_audited | probabilistic, manual | finance | Tax system |
| Haggled a great deal | haggled_great_deal | probabilistic, manual | finance | Shopping action |
| Was overcharged | was_overcharged | probabilistic, manual | finance | Shopping action mishap |
| Lent money to a friend | lent_money_to_friend | probabilistic, manual | finance | Loan/gift action |
| Was never paid back | never_paid_back | probabilistic | finance | - |
| Splurged on a treat | splurged_on_treat | probabilistic, manual | finance | Shopping action |
| Tightened the belt | tightened_the_belt | probabilistic, manual | finance | Household budget rule |
| Received a windfall | received_windfall | probabilistic | finance | - |
| Made a new friend | made_new_friend | probabilistic, manual | social | Social interaction action (friendship event) |
| Drifted apart from a friend | drifted_apart | probabilistic, manual | social | Friendship decay tick |
| Had a falling out | had_falling_out | probabilistic, manual | social | Argument event chain |
| Buried the hatchet | buried_the_hatchet | probabilistic, manual | social | Reconciliation action |
| Threw a party | threw_party | probabilistic, manual | social | Party action |
| Attended a party | attended_party | probabilistic, manual | social | Party action |
| Was the life of the party | was_life_of_party | manual | social | Party action outcome |
| Embarrassed themselves at a party | embarrassed_at_party | probabilistic, manual | social | Party action mishap |
| Wasn't invited | was_not_invited | probabilistic | social | - |
| Got stood up | got_stood_up | probabilistic, manual | social | Date action failure |
| Ran into an old friend | ran_into_old_friend | probabilistic, manual | social | Street encounter system |
| Caught up over coffee | caught_up_over_coffee | probabilistic, manual | social | Cafe visit action |
| Received a surprise visit | received_surprise_visit | probabilistic, manual | social | Visit action |
| Gave a gift | gave_gift | probabilistic, manual | social | Gift action |
| Received a gift | received_gift | probabilistic, manual | social | Gift action |
| Re-gifted a present | regifted_present | probabilistic | social | - |
| Was gossiped about | was_gossiped_about | probabilistic, manual | social | Rumor system |
| Spread a rumor | spread_rumor | probabilistic, manual | social | Rumor system |
| Apologized first | apologized_first | probabilistic, manual | social | Reconciliation action |
| Won an argument | won_argument | manual | social | Argument event outcome |
| Lost an argument | lost_argument | manual | social | Argument event outcome |
| Made a frenemy | made_frenemy | probabilistic | social | - |
| Joined a friend group | joined_friend_group | probabilistic | social | - |
| Was excluded from the group | excluded_from_group | probabilistic | social | - |
| Hosted a dinner party | hosted_dinner_party | probabilistic, manual | social | Cooking action (party) |
| Had a heart-to-heart | had_heart_to_heart | probabilistic, manual | social | Social interaction action |
| Kept a friend's secret | kept_secret | probabilistic | social | - |
| Let slip a secret | let_slip_secret | probabilistic | social | - |
| Became pen pals | became_pen_pals | probabilistic | social | - |
| Got a nickname | got_nickname | probabilistic | social | - |
| Moved into a new home | moved_into_new_home | manual | housing | Household placement / relocation helper |
| Moved out of the parents' house | moved_out_of_parents | probabilistic, manual | housing | HousingMarket (move_out event, task 024) |
| Was evicted | was_evicted | manual | housing | Eviction system (task 022) |
| Became homeless | became_homeless | manual | housing | Eviction system (task 022) |
| Got back on their feet | got_back_on_feet | manual | housing | Recovery system (task 022) |
| Bought a first home | bought_first_home | probabilistic, manual | housing | HousingMarket |
| Sold a home | sold_home | manual | housing | HousingMarket |
| Redecorated the living room | redecorated_living_room | probabilistic, manual | housing | Home improvement action |
| Renovated the kitchen | renovated_kitchen | probabilistic, manual | housing | Home improvement action |
| Fixed a leaky faucet | fixed_leaky_faucet | probabilistic, manual | housing | Home maintenance action |
| Had a pipe burst | pipe_burst | probabilistic, manual | housing | Home wear system |
| Dealt with a roof leak | roof_leaked | probabilistic, manual | housing | Home wear system (storm) |
| Found mold in the bathroom | found_mold | probabilistic, manual | housing | Home wear system |
| Had a pest infestation | had_pest_infestation | probabilistic, manual | housing | Home wear system |
| Called the exterminator | called_exterminator | probabilistic, manual | housing | Home maintenance action |
| Got locked out of the house | locked_out_of_house | probabilistic, manual | housing | Morning routine mishap |
| Lost the house keys | lost_house_keys | probabilistic, manual | housing | Commute mishap rule |
| Changed the locks | changed_locks | probabilistic, manual | housing | Home maintenance action |
| Got new neighbors | got_new_neighbors | manual | housing | Household placement signal |
| Welcomed the neighbors with a pie | welcomed_neighbors_with_pie | probabilistic, manual | housing | Gift action |
| Threw a housewarming party | had_housewarming | probabilistic, manual | housing | Party action |
| Planted a garden | planted_garden | probabilistic, manual | housing | Gardening action |
| Mowed the lawn | mowed_lawn | probabilistic, manual | housing | Yard work action |
| Let the lawn go wild | let_lawn_go_wild | probabilistic | housing | - |
| Took in a roommate | took_in_roommate | probabilistic, manual | housing | HousingMarket |
| Downsized to a smaller place | downsized_home | probabilistic | housing | - |
| Lost the home to foreclosure | lost_home_to_foreclosure | manual | housing | Loan system |
| Cleaned out the attic | cleaned_out_attic | probabilistic, manual | housing | Chore action |
| Got a parking ticket | got_parking_ticket | probabilistic, manual | legal | Traffic system |
| Got a speeding ticket | got_speeding_ticket | probabilistic, manual | legal | Driving action mishap |
| Contested a ticket | contested_ticket | probabilistic, manual | legal | Courthouse visit action |
| Won in small-claims court | won_small_claims | probabilistic, manual | legal | Court system |
| Lost in small-claims court | lost_small_claims | probabilistic, manual | legal | Court system |
| Was sued by a neighbor | sued_by_neighbor | probabilistic, manual | legal | Neighbor dispute escalation |
| Sued a business | sued_business | probabilistic | legal | - |
| Served jury duty | served_jury_duty | probabilistic, manual | legal | Court summons system |
| Was called as a witness | called_as_witness | manual | legal | Crime system |
| Signed a contract | signed_contract | manual | legal | Business deal action |
| Was scammed | was_scammed | probabilistic, manual | legal | Scam system |
| Reported a scam | reported_scam | manual | legal | Police report action |
| Filed a noise complaint | filed_noise_complaint | probabilistic, manual | legal | Neighbor dispute system |
| Received a noise complaint | received_noise_complaint | manual | legal | Neighbor dispute system |
| Got a permit approved | got_permit_approved | manual | legal | City hall system |
| Had a permit denied | permit_denied | manual | legal | City hall system |
| Was fined by the city | fined_by_city | probabilistic, manual | legal | City ordinance rule |
| Notarized a document | notarized_document | probabilistic, manual | legal | City hall visit action |
| Changed their legal name | changed_legal_name | probabilistic | legal | - |
| Disputed an inheritance | disputed_inheritance | probabilistic | legal | - |
| Settled out of court | settled_out_of_court | probabilistic | legal | - |
| Bailed a friend out | bailed_out_friend | manual | legal | Arrest system signal |
| Was wrongly accused | was_wrongly_accused | probabilistic | legal | - |
| Was cleared of charges | cleared_of_charges | manual | legal | Court system |
| Updated their insurance | updated_insurance | probabilistic, manual | legal | Paperwork action |
| Took up painting | took_up_painting | probabilistic, manual | hobby | Hobby shop visit action |
| Finished a painting | finished_painting | probabilistic, manual | hobby | Painting action |
| Took up photography | took_up_photography | probabilistic | hobby | - |
| Learned an instrument | learned_instrument | probabilistic, manual | hobby | Practice action |
| Played in a band | played_in_band | probabilistic, manual | hobby | Music practice action |
| Wrote a song | wrote_song | probabilistic, manual | hobby | Music practice action |
| Started writing a novel | started_writing_novel | probabilistic | hobby | - |
| Finished writing a novel | finished_writing_novel | probabilistic, manual | hobby | Writing action streak |
| Got a short story published | got_story_published | probabilistic, manual | hobby | Writing action outcome |
| Started a stamp collection | started_stamp_collection | probabilistic | hobby | - |
| Completed a jigsaw puzzle | completed_puzzle | probabilistic, manual | hobby | Leisure action |
| Knitted a sweater | knitted_sweater | probabilistic, manual | hobby | Knitting action |
| Took up woodworking | took_up_woodworking | probabilistic | hobby | - |
| Built a birdhouse | built_birdhouse | probabilistic, manual | hobby | Woodworking action |
| Went fishing | went_fishing | probabilistic, manual | hobby | Fishing action |
| Caught a huge fish | caught_huge_fish | probabilistic, manual | hobby | Fishing action outcome |
| Lost the one that got away | fish_got_away | probabilistic, manual | hobby | Fishing action outcome |
| Joined a book club | joined_book_club | probabilistic, manual | hobby | Community board system |
| Finished a great book | finished_great_book | probabilistic, manual | hobby | Reading action |
| Started a scrapbook | started_scrapbook | probabilistic | hobby | - |
| Won a chess match | won_chess_match | probabilistic, manual | hobby | Board game action |
| Lost a chess match | lost_chess_match | probabilistic, manual | hobby | Board game action |
| Took a pottery class | took_pottery_class | probabilistic, manual | hobby | Class attendance action |
| Grew a prize tomato | grew_prize_tomato | probabilistic, manual | hobby | Gardening action |
| Flew a kite | flew_kite | probabilistic, manual | hobby | Park visit action |
| Went birdwatching | went_birdwatching | probabilistic, manual | hobby | Park visit action |
| Spotted a rare bird | spotted_rare_bird | probabilistic, manual | hobby | Birdwatching action |
| Learned magic tricks | learned_magic_tricks | probabilistic | hobby | - |
| Performed at open mic night | performed_open_mic | probabilistic, manual | hobby | Venue event system |
| Gave up a hobby | gave_up_hobby | probabilistic | hobby | - |
| Was born | was_born | manual | milestone | Birth system (birth effect) |
| Took first steps | took_first_steps | probabilistic, manual | milestone | Infant growth tick |
| Said a first word | said_first_word | probabilistic, manual | milestone | Infant growth tick |
| Celebrated a birthday | celebrated_birthday | manual | milestone | Calendar system |
| Turned 18 | turned_18 | manual | milestone | Calendar system |
| Turned 30 | turned_30 | manual | milestone | Calendar system |
| Turned 50 | turned_50 | manual | milestone | Calendar system |
| Turned 100 | turned_100 | manual | milestone | Calendar system |
| Got a driver's license | got_drivers_license | probabilistic, manual | milestone | Driving test system |
| Failed the driving test | failed_driving_test | probabilistic, manual | milestone | Driving test system |
| Bought a first car | bought_first_car | probabilistic, manual | milestone | Vehicle purchase action |
| Cast a first vote | cast_first_vote | manual | milestone | Election system |
| Earned a first paycheck | earned_first_paycheck | manual | milestone | Wage system (first payout) |
| Had a midlife crisis | had_midlife_crisis | probabilistic, manual | milestone | Birthday milestone rule |
| Reinvented themselves | reinvented_themselves | probabilistic | milestone | - |
| Left home for the first time | left_home_first_time | manual | milestone | Move-out handler (task 024) |
| Became a grandparent | became_grandparent | manual | milestone | Birth system signal |
| Became a great-grandparent | became_great_grandparent | manual | milestone | Birth system signal |
| Celebrated a silver anniversary | celebrated_silver_anniversary | manual | milestone | Calendar system |
| Celebrated a golden anniversary | celebrated_golden_anniversary | manual | milestone | Calendar system |
| Reached retirement age | reached_retirement_age | manual | milestone | Calendar / retirement system |
| Marked ten years in town | ten_years_in_town | manual | milestone | Calendar system |
| Checked off a bucket-list item | checked_bucket_list_item | probabilistic, manual | milestone | Travel/leisure action |
| Wrote a bucket list | wrote_bucket_list | probabilistic | milestone | - |
| Learned to swim | learned_to_swim | probabilistic, manual | milestone | Swimming lesson action |
| Broke an arm | broke_arm | probabilistic, manual | accident | Risky activity action |
| Broke a leg | broke_leg | probabilistic, manual | accident | Sports action mishap |
| Twisted a knee | twisted_knee | probabilistic | accident | - |
| Slipped on ice | slipped_on_ice | probabilistic, manual | accident | Weather system (winter) |
| Fell off a ladder | fell_off_ladder | probabilistic, manual | accident | Home maintenance action |
| Fell down the stairs | fell_down_stairs | probabilistic, manual | accident | Home hazard rule |
| Cut a finger cooking | cut_finger_cooking | probabilistic, manual | accident | Cooking action mishap |
| Burned a hand on the stove | burned_hand_on_stove | probabilistic, manual | accident | Cooking action mishap |
| Got a paper cut | got_paper_cut | probabilistic, manual | accident | Office work action |
| Stubbed a toe | stubbed_toe | probabilistic, manual | accident | Home hazard rule |
| Was stung by a bee | stung_by_bee | probabilistic, manual | accident | Gardening action |
| Was bitten by a dog | bitten_by_dog | probabilistic, manual | accident | Pet encounter system |
| Crashed the car | crashed_car | probabilistic, manual | accident | Driving system |
| Had a fender bender | had_fender_bender | probabilistic, manual | accident | Driving system |
| Was hit by a cyclist | hit_by_cyclist | probabilistic, manual | accident | Traffic system |
| Nearly got hit crossing the street | near_miss_crossing | probabilistic, manual | accident | Traffic system |
| Tripped over the pet | tripped_over_pet | probabilistic, manual | accident | Pet system |
| Dropped the phone in the toilet | dropped_phone_in_toilet | probabilistic | accident | - |
| Got a concussion | got_concussion | probabilistic, manual | accident | Sports action mishap |
| Choked on food | choked_on_food | probabilistic, manual | accident | Eating action mishap |
| Set off the smoke alarm | set_off_smoke_alarm | probabilistic, manual | accident | Cooking action mishap |
| Started a small kitchen fire | started_kitchen_fire | probabilistic, manual | accident | Cooking action mishap |
| Was shocked by an outlet | shocked_by_outlet | probabilistic, manual | accident | Home repair action mishap |
| Sprained a wrist | sprained_wrist | probabilistic, manual | accident | Sports action mishap |
| Got something in their eye | got_something_in_eye | probabilistic | accident | - |
| Walked into a glass door | walked_into_glass_door | probabilistic, manual | accident | Distraction rule |
| Recovered from an injury | recovered_from_injury | probabilistic, manual | accident | Recovery system (recovery event) |
| Had a near-miss at work | had_workplace_near_miss | probabilistic, manual | accident | Work action mishap |
| Was pickpocketed | was_pickpocketed | probabilistic | crime-mischief | - |
| Was burgled | was_burgled | probabilistic, manual | crime-mischief | Crime system |
| Reported a burglary | reported_burglary | manual | crime-mischief | Police report action |
| Witnessed a crime | witnessed_crime | probabilistic, manual | crime-mischief | Crime system |
| Shoplifted a candy bar | shoplifted_candy_bar | probabilistic, manual | crime-mischief | Store visit action |
| Got caught shoplifting | caught_shoplifting | probabilistic, manual | crime-mischief | Store security rule |
| Vandalized a fence | vandalized_fence | probabilistic | crime-mischief | - |
| Egged a house | egged_house | probabilistic, manual | crime-mischief | Mischief action |
| Had their house egged | house_was_egged | probabilistic, manual | crime-mischief | Mischief system |
| TP'd a neighbor's tree | tped_neighbors_tree | probabilistic, manual | crime-mischief | Mischief action |
| Pulled a prank | pulled_prank | probabilistic, manual | crime-mischief | Mischief action |
| Fell for a prank | fell_for_prank | probabilistic, manual | crime-mischief | Mischief action |
| Jaywalked | jaywalked | probabilistic, manual | crime-mischief | Pathfinding shortcut rule |
| Snuck out at night | snuck_out_at_night | probabilistic, manual | crime-mischief | Teen mischief rule |
| Got caught sneaking out | caught_sneaking_out | probabilistic, manual | crime-mischief | Parenting rule |
| Trespassed in an empty lot | trespassed_empty_lot | probabilistic | crime-mischief | - |
| Was questioned by the police | questioned_by_police | manual | crime-mischief | Crime system |
| Was arrested | was_arrested | probabilistic, manual | crime-mischief | Crime system |
| Paid a fine | paid_fine | manual | crime-mischief | Court system |
| Did community service | did_community_service | manual | crime-mischief | Court system |
| Stole a garden gnome | stole_garden_gnome | probabilistic | crime-mischief | - |
| Returned the garden gnome | returned_garden_gnome | probabilistic | crime-mischief | - |
| Keyed a car | keyed_car | probabilistic, manual | crime-mischief | Mischief action |
| Had their car keyed | car_was_keyed | probabilistic, manual | crime-mischief | Mischief system |
| Started a food fight | started_food_fight | probabilistic, manual | crime-mischief | School cafeteria action |
| Got away with it | got_away_with_it | manual | crime-mischief | Crime system outcome |
| Turned themselves in | turned_themselves_in | probabilistic | crime-mischief | - |
| Went straight | went_straight | probabilistic | crime-mischief | - |
| Lost a first tooth | lost_first_tooth | probabilistic, manual | childhood | Growth tick |
| Was visited by the tooth fairy | visited_by_tooth_fairy | manual | childhood | Parenting action |
| Learned to ride a bike | learned_to_ride_bike | probabilistic, manual | childhood | Practice action |
| Fell off the bike | fell_off_bike | probabilistic, manual | childhood | Bike practice action |
| Learned to tie shoelaces | learned_to_tie_shoes | probabilistic | childhood | - |
| Built a blanket fort | built_blanket_fort | probabilistic, manual | childhood | Play action |
| Had an imaginary friend | had_imaginary_friend | probabilistic | childhood | - |
| Outgrew the imaginary friend | outgrew_imaginary_friend | probabilistic | childhood | - |
| Made a best friend at recess | made_recess_best_friend | probabilistic, manual | childhood | School attendance action |
| Won a game of tag | won_game_of_tag | probabilistic, manual | childhood | Play action |
| Scraped a knee | scraped_knee | probabilistic, manual | childhood | Play action mishap |
| Climbed a tree | climbed_tree | probabilistic, manual | childhood | Play action |
| Got stuck in a tree | got_stuck_in_tree | probabilistic, manual | childhood | Play action mishap |
| Caught fireflies | caught_fireflies | probabilistic, manual | childhood | Evening play action |
| Had a growth spurt | had_growth_spurt | probabilistic, manual | childhood | Growth tick |
| Got braces | got_braces | probabilistic | childhood | - |
| Got the braces off | got_braces_off | manual | childhood | Dentist visit action |
| Went trick-or-treating | went_trick_or_treating | probabilistic, manual | childhood | Holiday system |
| Believed in the town legend | believed_town_legend | probabilistic | childhood | - |
| Had a first sleepover | had_first_sleepover | probabilistic, manual | childhood | Sleepover action |
| Got homesick at a sleepover | got_homesick | probabilistic, manual | childhood | Sleepover action outcome |
| Won a sandcastle contest | won_sandcastle_contest | probabilistic | childhood | - |
| Learned to whistle | learned_to_whistle | probabilistic | childhood | - |
| Lost a balloon to the sky | lost_balloon | probabilistic, manual | childhood | Fair visit action |
| Had a first crush | had_first_crush | probabilistic, manual | childhood | School attendance action |
| Passed a note in class | passed_note_in_class | probabilistic, manual | childhood | School attendance action |
| Was picked last for the team | picked_last_for_team | probabilistic, manual | childhood | School sports action |
| Was picked first for the team | picked_first_for_team | probabilistic, manual | childhood | School sports action |
| Ran a lemonade stand | ran_lemonade_stand | probabilistic, manual | childhood | Play action (entrepreneur) |
| Earned a later bedtime | earned_later_bedtime | probabilistic | childhood | - |
| Found a first gray hair | found_first_gray_hair | probabilistic | aging | - |
| Went fully gray | went_fully_gray | probabilistic | aging | - |
| Started balding | started_balding | probabilistic | aging | - |
| Embraced the bald look | embraced_bald_look | probabilistic | aging | - |
| Needed reading glasses | needed_reading_glasses | probabilistic | aging | - |
| Got hearing aids | got_hearing_aids | probabilistic, manual | aging | Clinic visit action |
| Developed hearing loss | developed_hearing_loss | probabilistic | aging | - |
| Started using a cane | started_using_cane | probabilistic | aging | - |
| Got a hip replacement | got_hip_replacement | probabilistic, manual | aging | Hospital system |
| Complained about their knees | complained_about_knees | probabilistic | aging | - |
| Took up early-bird dinners | took_up_early_dinners | probabilistic | aging | - |
| Began afternoon naps | began_afternoon_naps | probabilistic | aging | - |
| Forgot where the keys were | forgot_where_keys_were | probabilistic | aging | - |
| Started repeating stories | started_repeating_stories | probabilistic | aging | - |
| Downshifted to part-time | downshifted_part_time | probabilistic, manual | aging | Job Orchestrator |
| Mentored a young neighbor | mentored_young_neighbor | probabilistic | aging | - |
| Became the neighborhood elder | became_neighborhood_elder | manual | aging | Community system |
| Told kids to get off the lawn | yelled_get_off_my_lawn | probabilistic | aging | - |
| Joined the seniors' club | joined_seniors_club | probabilistic | aging | - |
| Won at bingo | won_at_bingo | probabilistic, manual | aging | Seniors' club action |
| Wrote their memoirs | wrote_memoirs | probabilistic | aging | - |
| Passed down a recipe | passed_down_recipe | probabilistic, manual | aging | Cooking action (family) |
| Taught a grandchild to fish | taught_grandchild_to_fish | probabilistic, manual | aging | Fishing action (family) |
| Spoiled the grandkids | spoiled_grandkids | probabilistic, manual | aging | Gift action |
| Celebrated their 90th with the whole town | celebrated_90th | manual | aging | Calendar system |
| Barely renewed their driver's license | barely_renewed_license | manual | aging | Driving test system |
| Gave up driving | gave_up_driving | probabilistic | aging | - |
| Reflected on a life well lived | reflected_on_life | probabilistic | aging | - |
| Voted in a town election | voted_in_election | manual | community | Election system |
| Ran for town council | ran_for_council | probabilistic | community | - |
| Won a council seat | won_council_seat | manual | community | Election system |
| Lost an election | lost_election | manual | community | Election system |
| Volunteered at a shelter | volunteered_at_shelter | probabilistic, manual | community | Volunteer action |
| Organized a food drive | organized_food_drive | probabilistic | community | - |
| Donated to charity | donated_to_charity | probabilistic, manual | community | Donation action |
| Attended a town meeting | attended_town_meeting | probabilistic, manual | community | Civic action |
| Spoke up at a town meeting | spoke_at_town_meeting | probabilistic | community | - |
| Joined the neighborhood watch | joined_neighborhood_watch | probabilistic | community | - |
| Attended the town fair | attended_town_fair | probabilistic, manual | community | Festival system |
| Won the pie-eating contest | won_pie_eating_contest | probabilistic, manual | community | Festival system |
| Judged the baking contest | judged_baking_contest | probabilistic, manual | community | Festival system |
| Helped a stranger | helped_stranger | probabilistic | community | - |
| Was helped by a stranger | helped_by_stranger | probabilistic | community | - |
| Gave directions to a newcomer | gave_directions | probabilistic, manual | community | Street encounter system |
| Shoveled a neighbor's walk | shoveled_neighbors_walk | probabilistic, manual | community | Weather system (winter) |
| Fed the neighborhood cats | fed_neighborhood_cats | probabilistic, manual | community | Pet care action |
| Had a dispute with a neighbor | had_neighbor_dispute | probabilistic | community | - |
| Settled a neighbor dispute | settled_neighbor_dispute | probabilistic | community | - |
| Borrowed a cup of sugar | borrowed_cup_of_sugar | probabilistic, manual | community | Neighbor interaction action |
| Lent out the lawnmower | lent_lawnmower | probabilistic, manual | community | Neighbor interaction action |
| Never got the lawnmower back | lawnmower_never_returned | probabilistic | community | - |
| Joined the church choir | joined_choir | probabilistic | community | - |
| Planted a tree downtown | planted_town_tree | manual | community | Civic action |
| Cleaned up the park | cleaned_up_park | probabilistic, manual | community | Volunteer action |
| Became a local legend | became_local_legend | probabilistic | community | - |
| Got their photo in the paper | photo_in_local_paper | manual | community | Newspaper system |
| Bought a new couch | bought_new_couch | probabilistic, manual | possessions | Furniture shopping action |
| Assembled flat-pack furniture | assembled_flatpack | probabilistic, manual | possessions | Furniture assembly action |
| Was defeated by flat-pack furniture | flatpack_defeated_them | probabilistic, manual | possessions | Furniture assembly action mishap |
| Bought a new TV | bought_new_tv | manual | possessions | Electronics shopping action |
| Had the TV break down | tv_broke_down | probabilistic | possessions | - |
| Fixed the TV with a whack | fixed_tv_with_whack | probabilistic | possessions | - |
| Lost their keys | lost_keys | probabilistic | possessions | - |
| Found the keys in the fridge | found_keys_in_fridge | probabilistic | possessions | - |
| Lost their phone | lost_phone | probabilistic | possessions | - |
| Cracked the phone screen | cracked_phone_screen | probabilistic, manual | possessions | Accident rule |
| Upgraded their phone | upgraded_phone | probabilistic, manual | possessions | Electronics shopping action |
| Bought a new car | bought_new_car | manual | possessions | Vehicle purchase action |
| Had the car break down | car_broke_down | probabilistic, manual | possessions | Vehicle wear system |
| Got the car repaired | got_car_repaired | manual | possessions | Auto repair visit action |
| Washed the car | washed_car | probabilistic, manual | possessions | Chore action |
| Had a bird ruin the clean car | bird_ruined_clean_car | probabilistic | possessions | - |
| Bought an umbrella | bought_umbrella | manual | possessions | Shopping action (rain) |
| Left the umbrella at the cafe | left_umbrella_at_cafe | probabilistic | possessions | - |
| Inherited grandma's china | inherited_china | manual | possessions | Estate system |
| Broke grandma's china | broke_china | probabilistic | possessions | - |
| Found a treasure at a yard sale | yard_sale_treasure | probabilistic, manual | possessions | Yard sale action |
| Held a yard sale | held_yard_sale | probabilistic, manual | possessions | Yard sale action |
| Decluttered the house | decluttered_house | probabilistic, manual | possessions | Chore action |
| Couldn't throw anything away | hoarded_everything | probabilistic | possessions | - |
| Bought new shoes | bought_new_shoes | probabilistic, manual | possessions | Shopping action |
| Wore a hole in the old shoes | wore_hole_in_shoes | probabilistic | possessions | - |
| Got a watch repaired | got_watch_repaired | manual | possessions | Repair shop visit action |
| Lost a lucky charm | lost_lucky_charm | probabilistic | possessions | - |
| Took a day trip | took_day_trip | probabilistic, manual | travel | Travel action |
| Missed a ride home | missed_ride_home | manual | travel | Commute system failure |
| Went on vacation | went_on_vacation | probabilistic | travel | - |
| Came home from vacation | came_home_from_vacation | manual | travel | Travel action return |
| Had a staycation | had_staycation | probabilistic | travel | - |
| Got lost in their own town | got_lost_in_town | probabilistic | travel | - |
| Found a shortcut | found_shortcut | probabilistic, manual | travel | Pathfinding discovery rule |
| Took the scenic route | took_scenic_route | manual | travel | Commute variation rule |
| Watched the sunrise from the hill | watched_sunrise | probabilistic, manual | travel | Outing action |
| Went camping | went_camping | probabilistic | travel | - |
| Got rained out camping | rained_out_camping | manual | travel | Weather system |
| Visited the next town over | visited_next_town | probabilistic | travel | - |
| Sent a postcard | sent_postcard | probabilistic, manual | travel | Travel action |
| Received a postcard | received_postcard | manual | travel | Mail system |
| Planned a dream trip | planned_dream_trip | probabilistic | travel | - |
| Canceled a trip | canceled_trip | probabilistic, manual | travel | Finance rule (low funds) |
| Packed the night before | packed_night_before | probabilistic, manual | travel | Travel action prep |
| Forgot to pack socks | forgot_to_pack_socks | probabilistic | travel | - |
| Hiked the ridge trail | hiked_ridge_trail | probabilistic, manual | travel | Hiking action |
| Got a blister hiking | got_blister_hiking | probabilistic, manual | travel | Hiking action mishap |
| Skipped town for a weekend | skipped_town_weekend | probabilistic | travel | - |
| Was homesick while away | homesick_while_away | probabilistic | travel | - |
| Collected a souvenir | collected_souvenir | probabilistic, manual | travel | Travel action |
| Swam in the lake | swam_in_lake | probabilistic, manual | travel | Swimming action |
| Went stargazing | went_stargazing | probabilistic, manual | travel | Evening outing action |
| Had a road-trip singalong | had_road_trip_singalong | manual | travel | Travel action (group) |
| Had car trouble mid-trip | had_car_trouble_on_trip | probabilistic, manual | travel | Vehicle wear system |
| Vowed to travel more | vowed_to_travel_more | probabilistic | travel | - |
| Was caught in the rain | caught_in_rain | probabilistic, manual | weather-reaction | Weather system |
| Danced in the rain | danced_in_rain | probabilistic | weather-reaction | - |
| Jumped in puddles | jumped_in_puddles | probabilistic, manual | weather-reaction | Weather system (rain, child) |
| Built a snowman | built_snowman | probabilistic, manual | weather-reaction | Weather system (snow) |
| Won a snowball fight | won_snowball_fight | probabilistic, manual | weather-reaction | Snow play action |
| Was snowed in | was_snowed_in | manual | weather-reaction | Weather system (blizzard) |
| Shoveled the driveway | shoveled_driveway | probabilistic, manual | weather-reaction | Weather system (snow) |
| Got sunburned | got_sunburned | probabilistic, manual | weather-reaction | Heatwave system |
| Complained about the heat | complained_about_heat | probabilistic, manual | weather-reaction | Heatwave system |
| Beat the heat with ice cream | beat_heat_with_ice_cream | probabilistic, manual | weather-reaction | Heatwave system |
| Lost power in a storm | lost_power_in_storm | manual | weather-reaction | Storm system |
| Lit candles during the outage | lit_candles_in_outage | manual | weather-reaction | Power outage system |
| Saw the power come back on | power_came_back | manual | weather-reaction | Power outage system |
| Watched a thunderstorm | watched_thunderstorm | probabilistic | weather-reaction | - |
| Was scared by thunder | scared_by_thunder | probabilistic | weather-reaction | - |
| Had the umbrella flip inside out | umbrella_flipped | probabilistic, manual | weather-reaction | Wind system |
| Chased a runaway hat | chased_runaway_hat | probabilistic, manual | weather-reaction | Wind system |
| Saw a rainbow | saw_rainbow | probabilistic, manual | weather-reaction | Weather system (post-rain) |
| Saw a double rainbow | saw_double_rainbow | probabilistic | weather-reaction | - |
| Saw the first snow of the year | saw_first_snow | manual | weather-reaction | Weather system (season) |
| Raked the autumn leaves | raked_leaves | manual | weather-reaction | Season system (fall) |
| Jumped in the leaf pile | jumped_in_leaf_pile | probabilistic | weather-reaction | - |
| Smelled the spring blossoms | smelled_spring_blossoms | manual | weather-reaction | Season system (spring) |
| Basked in a perfect day | basked_in_perfect_day | probabilistic | weather-reaction | - |
| Predicted rain with their knee | predicted_rain_with_knee | probabilistic | weather-reaction | - |
| Adopted a dog | adopted_dog | probabilistic, manual | pet | Pet adoption action |
| Adopted a cat | adopted_cat | probabilistic, manual | pet | Pet adoption action |
| Adopted a goldfish | adopted_goldfish | probabilistic, manual | pet | Pet shop visit action |
| Named the new pet | named_pet | manual | pet | Pet adoption action |
| Taught the pet a trick | pet_learned_trick | probabilistic, manual | pet | Pet training action |
| Saw the pet fail obedience school | pet_failed_obedience | probabilistic, manual | pet | Pet training action |
| Walked the dog | walked_dog | probabilistic, manual | pet | Pet care action |
| Was walked by the dog | dog_walked_them | probabilistic | pet | - |
| Had a pet run away | pet_ran_away | probabilistic, manual | pet | Pet care neglect rule |
| Had the pet come back | pet_came_back | probabilistic | pet | - |
| Put up lost-pet posters | put_up_lost_pet_posters | manual | pet | Lost pet system |
| Found someone's lost pet | found_lost_pet | probabilistic | pet | - |
| Had a pet fall sick | pet_got_sick | probabilistic, manual | pet | Pet system |
| Took the pet to the vet | took_pet_to_vet | probabilistic, manual | pet | Vet visit action |
| Saw the pet recover | pet_recovered | manual | pet | Vet system |
| Lost a pet | pet_passed_away | probabilistic, manual | pet | Pet system |
| Buried a pet in the yard | buried_pet_in_yard | manual | pet | Pet death signal |
| Had a pet have a litter | pet_had_litter | probabilistic | pet | - |
| Gave away kittens | gave_away_kittens | manual | pet | Pet system |
| Received a "gift" from the cat | cat_brought_gift | probabilistic | pet | - |
| Had the dog eat the homework | dog_ate_homework | probabilistic, manual | pet | Pet mischief rule |
| Had the pet destroy the couch | pet_destroyed_couch | probabilistic | pet | - |
| Built a doghouse | built_doghouse | manual | pet | Woodworking action |
| Taught the parrot a word | taught_parrot_word | probabilistic, manual | pet | Pet training action |
| Was embarrassed by the parrot | parrot_embarrassed_them | probabilistic | pet | - |
| Entered the pet in a show | entered_pet_show | probabilistic, manual | pet | Festival system |
| Saw the pet win a ribbon | pet_won_ribbon | probabilistic, manual | pet | Pet show system |
| Fell asleep with the cat | fell_asleep_with_cat | probabilistic, manual | pet | Rest action |
| Cooked a meal | cooked_meal | probabilistic, manual | food | Cooking action |
| Burned dinner | burned_dinner | probabilistic, manual | food | Cooking action mishap |
| Tried a new recipe | tried_new_recipe | probabilistic, manual | food | Cooking action |
| Had a recipe turn out a disaster | recipe_disaster | manual | food | Cooking action outcome |
| Found a new favorite recipe | recipe_became_favorite | manual | food | Cooking action outcome |
| Baked bread from scratch | baked_bread | probabilistic, manual | food | Baking action |
| Baked cookies for the neighbors | baked_cookies_for_neighbors | manual | food | Baking action + gift action |
| Perfected grandma's recipe | perfected_grandmas_recipe | probabilistic | food | - |
| Ate out at a restaurant | ate_at_restaurant | probabilistic, manual | food | Dining action |
| Left a big tip | left_big_tip | probabilistic, manual | food | Dining action |
| Sent a dish back | sent_dish_back | probabilistic, manual | food | Dining action outcome |
| Discovered a favorite cafe | discovered_favorite_cafe | probabilistic, manual | food | Cafe visit action |
| Spilled coffee on a shirt | spilled_coffee_on_shirt | probabilistic, manual | food | Cafe visit mishap |
| Skipped breakfast | skipped_breakfast | probabilistic, manual | food | Morning routine rule |
| Had breakfast for dinner | had_breakfast_for_dinner | probabilistic | food | - |
| Grew their own vegetables | grew_own_vegetables | probabilistic, manual | food | Gardening action |
| Ate a questionable leftover | ate_questionable_leftover | probabilistic, manual | food | Eating action |
| Regretted the leftover | regretted_leftover | manual | food | Eating action outcome |
| Went grocery shopping | went_grocery_shopping | probabilistic, manual | food | Shopping action |
| Forgot the shopping list | forgot_shopping_list | probabilistic | food | - |
| Ran out of groceries | fridge_went_empty | manual | food | Household supplies rule |
| Hosted a barbecue | hosted_barbecue | probabilistic, manual | food | Party action (outdoor) |
| Won the chili cook-off | won_chili_cookoff | probabilistic, manual | food | Festival system |
| Gave up sweets | gave_up_sweets | probabilistic | food | - |
| Broke the sweets fast | broke_sweets_fast | probabilistic | food | - |
| Tried something exotic | tried_exotic_food | probabilistic, manual | food | Dining action |
| Found a hair in the soup | found_hair_in_soup | probabilistic, manual | food | Dining action mishap |
| Learned to use chopsticks | learned_chopsticks | probabilistic | food | - |
| Had a great day | had_great_day | probabilistic, manual | emotion-mood | Mood system tick |
| Had a terrible day | had_terrible_day | probabilistic, manual | emotion-mood | Mood system tick |
| Woke up on the wrong side of the bed | woke_up_grumpy | probabilistic | emotion-mood | - |
| Whistled all day | whistled_all_day | probabilistic | emotion-mood | - |
| Felt homesick | felt_homesick | probabilistic, manual | emotion-mood | Relocation signal |
| Felt lonely | felt_lonely | probabilistic, manual | emotion-mood | Social isolation rule |
| Shook off the loneliness | shook_off_loneliness | probabilistic | emotion-mood | - |
| Felt on top of the world | felt_on_top_of_world | manual | emotion-mood | Achievement signal |
| Cried at a sad song | cried_at_sad_song | probabilistic | emotion-mood | - |
| Laughed until it hurt | laughed_until_it_hurt | probabilistic, manual | emotion-mood | Party/social action |
| Got stage fright | got_stage_fright | probabilistic, manual | emotion-mood | Performance action |
| Overcame stage fright | overcame_stage_fright | manual | emotion-mood | Performance action outcome |
| Was jealous of a friend | felt_jealous_of_friend | probabilistic | emotion-mood | - |
| Counted their blessings | counted_blessings | probabilistic | emotion-mood | - |
| Had a good cry | had_good_cry | probabilistic | emotion-mood | - |
| Snapped at someone | snapped_at_someone | probabilistic, manual | emotion-mood | Stress rule |
| Apologized for snapping | apologized_for_snapping | probabilistic, manual | emotion-mood | Reconciliation action |
| Felt overwhelmed | felt_overwhelmed | probabilistic, manual | emotion-mood | Stress rule |
| Took a mental health day | took_mental_health_day | probabilistic | emotion-mood | - |
| Started journaling | started_journaling | probabilistic | emotion-mood | - |
| Made a new year's resolution | made_resolution | manual | emotion-mood | Calendar system (new year) |
| Broke the resolution | broke_resolution | probabilistic | emotion-mood | - |
| Kept the resolution all year | kept_resolution | manual | emotion-mood | Calendar system (year end) |
| Daydreamed through the afternoon | daydreamed_afternoon | probabilistic | emotion-mood | - |
| Slept in gloriously | slept_in | probabilistic, manual | emotion-mood | Rest action |
| Overslept | overslept | probabilistic, manual | emotion-mood | Sleep rule |
| Had a nightmare | had_nightmare | probabilistic, manual | emotion-mood | Sleep system |
| Had a wonderful dream | had_wonderful_dream | probabilistic, manual | emotion-mood | Sleep system |
| Won a marathon | won_marathon | probabilistic, manual | achievement | Race event system |
| Finished a first 5K | finished_first_5k | probabilistic, manual | achievement | Race event system |
| Set a personal best | set_personal_best | probabilistic, manual | achievement | Exercise action |
| Won trivia night | won_trivia_night | probabilistic, manual | achievement | Venue event system |
| Won the karaoke contest | won_karaoke_contest | probabilistic, manual | achievement | Venue event system |
| Got a perfect attendance award | perfect_attendance_award | manual | achievement | School term system |
| Earned a black belt | earned_black_belt | probabilistic, manual | achievement | Martial arts class action |
| Broke a town record | broke_town_record | probabilistic | achievement | - |
| Was named citizen of the year | citizen_of_the_year | manual | achievement | Community awards system |
| Won a gardening prize | won_gardening_prize | probabilistic, manual | achievement | Festival system |
| Solved the crossword in ink | solved_crossword_in_ink | probabilistic | achievement | - |
| Beat their high score | beat_high_score | probabilistic, manual | achievement | Arcade/leisure action |
| Learned a language | learned_language | probabilistic | achievement | - |
| Held their breath the longest | held_breath_longest | probabilistic, manual | achievement | Pool play action |
| Bowled a perfect game | bowled_perfect_game | probabilistic, manual | achievement | Bowling action |
| Got a standing ovation | got_standing_ovation | manual | achievement | Performance action outcome |
| Framed their first dollar | framed_first_dollar | manual | achievement | Business opening system |
| Opened their own business | opened_own_business | probabilistic, manual | achievement | Business founding system |
| Saw the business turn a profit | business_turned_profit | manual | achievement | Economy monthly tick (task 020) |
| Saw the business go under | business_went_under | manual | achievement | Bankruptcy system (task 021) |
| Hired their first employee | hired_first_employee | manual | achievement | JobMarket hire |
| Paid off the mortgage | paid_off_mortgage | manual | achievement | Loan system |
| Fixed something unfixable | fixed_the_unfixable | probabilistic | achievement | - |
| Was quoted in the newspaper | quoted_in_newspaper | probabilistic | achievement | - |
| Finally finished the to-do list | finished_todo_list | probabilistic | achievement | - |
