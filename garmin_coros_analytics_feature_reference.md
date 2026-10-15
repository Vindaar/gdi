# Garmin and COROS: detailed performance and health analytics feature reference

**Research snapshot:** October 15, 2026  
**Purpose:** Competitive and product-feature research into how people can inspect, interpret, and act on their own sports-watch data.  
**Ecosystems covered:** Garmin watches, Garmin Connect mobile/web, and Garmin Connect+; COROS watches, the COROS app, EvoLab, and COROS Training Hub. Relevant accessory and external-service extensions are identified separately.

## Contents

1. [Scope and how to read the catalogue](#1-scope-and-how-to-read-the-catalogue)
2. [At-a-glance comparison](#2-at-a-glance-comparison)
3. [Garmin detailed feature catalogue](#3-garmin-detailed-feature-catalogue)
4. [COROS detailed feature catalogue](#4-coros-detailed-feature-catalogue)
5. [Important differences hidden by similar names](#5-important-differences-hidden-by-similar-names)
6. [Access, subscriptions, sensors, and data portability](#6-access-subscriptions-sensors-and-data-portability)
7. [Which capabilities are useful: product assessment](#7-which-capabilities-are-useful-product-assessment)
8. [Limitations and questions for hands-on validation](#8-limitations-and-questions-for-hands-on-validation)
9. [Source register](#9-source-register)

## 1. Scope and how to read the catalogue

This is a catalogue of **documented features that exist**, not a comparison of sensor accuracy or a claim that every model supports every feature. It focuses on analytics and the workflows surrounding them: recording useful context, reviewing workouts, finding trends, receiving recommendations, and taking data elsewhere. General navigation, maps, payments, music, messaging, and emergency features are excluded except where they directly support performance analysis or pacing. Specialist golf, diving, and aviation analytics are outside scope.

**The unit of comparison is the ecosystem, not just the watch.** Some scores are calculated on a compatible watch and then displayed in an app; some investigations happen only on the web; some require a chest strap, power meter, or subscription. Garmin's core Connect account and COROS Training Hub provide analysis without an additional analytics subscription. Garmin also sells a separate Connect+ feature layer. [G63][G63] [G07][G07] [C02][C02]

### Availability labels

| Label | Meaning |
|---|---|
| **Core** | Included native ecosystem capability; a compatible device/account may still be required. It does not mean every watch supports it. |
| **Model-dependent** | Explicitly dependent on watch generation, activity profile, firmware, or the presence of a particular sensor. |
| **Accessory** | Needs an external sensor for the specified measurement or fuller functionality. |
| **Connect+** | Part of Garmin's optional paid subscription, rather than the ordinary Connect feature set. |
| **External** | Depends on an authorized third-party service, which may have separate fees, limits, and privacy terms. |
| **Not verified** | No equivalent was established in the reviewed official documentation. This is not proof of absence. |

In the catalogue, **“user value” is an analytical assessment** of the decision a feature could support. It is not a claim that a manufacturer has clinically validated that decision. Likewise, the cautionary notes distinguish measured signals, model-derived estimates, and manually logged information.

Each entry has a stable feature ID: **GA-xx** for Garmin and **CO-xx** for COROS. Source links use **Gxx/Cxx** and resolve to official documentation in the source register.

## 2. At-a-glance comparison

This table is an index into the detailed catalogue, not a model-compatibility matrix.

| User need | Garmin implementation | COROS implementation |
|---|---|---|
| Inspect a completed workout | Connect activity charts, laps, maps, statistics. [G02][G02] | App activity summaries; detailed Training Hub analysis. [C03][C03] |
| Compare recorded sessions | Native web comparison of 2–4 activities. [G03][G03] | Hub filters, histories, and session inspection; equivalent native 2–4-session comparison workflow not verified. [C04][C04] |
| Build cross-domain charts | Connect+ Performance Dashboard. [G06][G06] | Native Hub dashboards; external AI can build additional analyses through COROS MCP. [C02][C02] [C33][C33] |
| Quantify cardiovascular training load | Exercise Load, Acute Load, Chronic Load, Load Ratio. [G09][G09] | Training Load, Base Fitness, Load Impact, Intensity Trend. [C28][C28] [C29][C29] [C30][C30] |
| Classify session stimulus | Aerobic/anaerobic Training Effect and primary benefit. [G12][G12] | Aerobic/anaerobic Training Effect and Training Focus. [C54][C54] |
| Assess readiness for training | Training Readiness combines training and recovery-related inputs. [G11][G11] | Recovery models recovery from training load; sleep/HRV are separate. [C06][C06] |
| Track running development | VO₂ max, thresholds, race predictions, Endurance/Hill scores, selected advanced running metrics. [G25][G25] [G29][G29] [G30][G30] | Running Fitness and subscores, VO₂ max, thresholds, race predictions, fitness tests. [C16][C16] [C17][C17] [C15][C15] |
| Assess a run against expected performance | Performance Condition. [G13][G13] | Running Efficiency. [C07][C07] |
| Analyze running mechanics | Running Dynamics; selected HRM 600-dependent metrics. [G16][G16] | Advanced running metrics and Running Form Test with compatible pod hardware. [C21][C21] [C20][C20] |
| Plan and review race pacing | PacePro and execution feedback. [G54][G54] | Pace Strategy, live progress, and planned-versus-actual review. [C50][C50] |
| Track cycling fitness | FTP and power-history analysis. [G25][G25] [G34][G34] | FTP/test, Cycling Efficiency, MMP curve, Cycling VO₂ max. [C19][C19] [C23][C23] [C26][C26] [C27][C27] |
| Receive a training plan | Garmin Coach variants and Daily Suggested Workouts. [G39][G39] [G38][G38] | Personalized Marathon Plans, workout/plan libraries, coach-authored plans, external AI-generated plans. [C37][C37] [C05][C05] [C32][C32] |
| Analyze sleep | Sleep stages, score, Sleep Coach, naps, alignment, selected breathing analytics. [G19][G19] [G20][G20] | Sleep stages, Sleep Score, consistency, naps, and editable sleep records. [C08][C08] [C09][C09] [C58][C58] |
| Monitor overnight HRV | HRV Status with personal baseline. [G24][G24] | Overnight HRV with personal normal range. [C11][C11] |
| Monitor daily stress | All-day stress and Body Battery. [G22][G22] [G23][G23] | Daily Stress; no separate native Body Battery equivalent verified. [C13][C13] |
| Review unusual overnight physiology | Health Status. [G17][G17] | Individual physiological trends and Wellness Check; an equivalent integrated overnight outlier feature was not verified. [C11][C11] [C12][C12] |
| Track menstrual cycles | Cycle/symptom tracking; additional pregnancy tracking. [G47][G47] [G48][G48] | Cycle/symptom tracking and predictions. [C49][C49] |
| Connect behavior with outcomes | Lifestyle Logging; additional Connect+ interpretation. [G18][G18] [G08][G08] | Training notes/RPE and Adventure Journal; a native automated habit-impact dashboard was not verified. [C48][C48] [C42][C42] |
| Take data elsewhere | Connect exports and account/device synchronization. [G32][G32] [G53][G53] | Workout exports/imports, third-party sync, and MCP access; bulk daily-health exports have a separate workflow. [C38][C38] [C44][C44] [C34][C34] [C32][C32] |

## 3. Garmin detailed feature catalogue

### 3.1 Workout inspection and user-controlled analysis

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-01 — Activity detail charts** | Presents a saved activity's time, distance, pace/speed, elevation, heart rate, calories, and recorded sport-specific series. Charts let the user inspect how variables changed through a session. [G02][G02] | Understand pacing, effort changes, climbs, and anomalous readings rather than relying on averages. | **Core; Connect app/web.** Available series depend on the recording device and sensors. |
| **GA-02 — Lap and interval analysis** | Breaks a workout into recorded laps or intervals, with segment-level statistics alongside the overall session. [G02][G02] | Check repetition consistency, deterioration late in a workout, and differences between work and recovery portions. | **Core.** The usefulness of the breakdown depends on how the activity and laps were recorded. |
| **GA-03 — Side-by-side activity comparison** | Garmin Connect web can compare **two to four of the user's activities**. [G03][G03] | Compare repeated workouts or routes without manually copying summary statistics. | **Core; web.** Different from a cross-domain dashboard or an automatic explanation of performance changes. |
| **GA-04 — Longitudinal reports** | Connect Reports aggregates historical health and fitness information into selectable reports and time periods. [G04][G04] | Review training consistency, volume, and longer-term changes. | **Core; especially web.** Metric/report availability varies; not an unrestricted query builder. |
| **GA-05 — Personal records** | Identifies and stores supported best performances, with record-management controls in Connect. [G05][G05] | Track concrete milestones independently of proprietary fitness scores. | **Core.** Supported record types vary by sport; GPS or recording errors can distort a claimed record. |
| **GA-06 — Activity editing** | Lets users correct supported activity information after upload, including descriptive fields and appropriate sport-specific details. [G33][G33] | Preserve a usable training history when recording or automatic recognition was wrong. | **Core; app/web.** Editing a summary is not a promise that every derived physiological metric will be recomputed. |
| **GA-07 — Custom Performance Dashboard** | Connect+ adds configurable charts combining performance and health variables, including strength and nutrition data. [G06][G06] | Investigate relationships across domains instead of opening disconnected metric cards. | **Connect+; web dashboard.** Desktop setup; mobile access uses the web experience. |
| **GA-08 — Training-block comparison** | The Performance Dashboard can compare the same selected variables across different time periods/training blocks. [G06][G06] | Ask whether a block differed in load, sleep, or other selected outcomes from an earlier block. | **Connect+.** Overlaying two variables does not control for confounding or establish causality. |
| **GA-09 — Active Intelligence** | Uses AI to produce personalized interpretations from available Garmin health and activity data. [G08][G08] | Reduce the effort needed to notice a pattern or understand a dashboard. | **Connect+.** Generated interpretation is distinct from the underlying sensor measurement or training-score algorithm. |

### 3.2 Training load, stimulus, and recovery

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-10 — Exercise Load** | Estimates the physiological load of an individual activity using an EPOC-based model: estimated excess post-exercise oxygen consumption. [G09][G09] | Compare the cardiovascular stress of sessions with different durations/intensities. | **Model-dependent.** It is not a measurement of muscle damage or simply distance traveled. |
| **GA-11 — Acute Load** | Combines recent exercise loads with time weighting; older sessions contribute less. [G09][G09] | Track how demanding recent training has been. | **Model-dependent.** Do not equate it with an unweighted sum of the last seven calendar days on every Garmin generation. |
| **GA-12 — Chronic Load and Load Ratio** | Chronic Load is a weighted average of acute-load history over **28 days**; Load Ratio compares acute with chronic load. [G09][G09] | See whether recent workload differs sharply from habitual workload. | **Model-dependent.** A workload ratio is not a validated personal injury threshold. |
| **GA-13 — Load Focus** | Groups approximately four weeks of training into **low aerobic, high aerobic, and anaerobic** contributions, with personalized target ranges. [G37][G37] | Detect an intensity mix that may not match the intended program. | **Model-dependent.** Requires accumulated history; unlike heart-rate-zone minutes, this is a classified load distribution. |
| **GA-14 — Aerobic and Anaerobic Training Effect** | Gives separate **0–5** estimates of a session's aerobic and anaerobic training stimulus; uses physiological/activity data and the user's training background. [G12][G12] | Distinguish an endurance stimulus from a short, high-intensity stimulus. | **Model-dependent.** These are modeled effects, not proof that adaptation has already occurred. |
| **GA-15 — Primary training benefit** | Labels a workout's dominant benefit, such as base, tempo, threshold, or anaerobic work, alongside Training Effect. [G12][G12] | Check whether the recorded session resembled its intended purpose. | **Model-dependent.** A single label compresses a mixed session. |
| **GA-16 — Training Status** | Interprets training in relation to estimated fitness changes; compatible implementations consider load, VO₂ max trends, and HRV-related context. Statuses distinguish productive, maintaining, recovery, and other conditions. [G10][G10] [G62][G62] | Ask whether the current training pattern appears to be supporting progress. | **Model-dependent.** Status depends on qualifying data and model generation; it is not simply “more load = better.” |
| **GA-17 — Recovery Time** | Estimates time until the next **hard workout**, using the completed activity and prior recovery state; supported devices also adjust for sleep, stress, and subsequent activity. [G60][G60] | Space demanding sessions and understand why recovery needs changed. | **Model-dependent.** A remaining countdown does not mean all easy exercise is prohibited. |
| **GA-18 — Training Readiness** | Combines last night's sleep score, Recovery Time, HRV Status, Acute Load, and recent sleep/stress history into a training-oriented readiness score. It updates through the day. [G11][G11] | Decide whether to keep, reduce, or reconsider a demanding planned session. | **Model-dependent.** Requires sustained wear/history. It is broader than Recovery Time and separate from Body Battery. |

**Why these should not be collapsed into one feature:** Exercise Load describes a workout input; Training Effect characterizes its stimulus; Training Status interprets a longer pattern; Recovery Time estimates recovery from exertion; Training Readiness adds broader current context. Counting all five merely as “recovery analytics” loses meaningful product differentiation. [G09][G09] [G12][G12] [G62][G62] [G60][G60] [G11][G11]

### 3.3 Running and endurance performance

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-19 — VO₂ max estimates** | Estimates aerobic capacity from qualifying activity and physiological data. Garmin supports running and cycling estimates on appropriate devices. [G25][G25] [G62][G62] | Track a modeled fitness trend over time. | **Model-dependent; cycling generally needs power and heart rate.** Not direct respiratory-gas measurement. |
| **GA-20 — Lactate threshold estimate** | Estimates the running intensity associated with lactate threshold, expressed through supported heart-rate/pace/power outputs; automatic detection is available on compatible configurations. [G26][G26] | Set more individualized training zones and follow threshold development. | **Model/sensor-dependent.** Test and automatic-detection requirements differ; do not assume every current implementation requires the same chest strap. |
| **GA-21 — Automatic physiological updates** | Compatible watches can automatically update selected measurements such as maximum heart rate, lactate threshold, and FTP from qualifying training. [G25][G25] | Reduce dependence on permanently fixed, age-based/default zones. | **Model-dependent.** Detection must be enabled and appropriate data collected; implausible changes deserve review. |
| **GA-22 — Performance Condition** | During a run or ride, compares current performance with the user's established fitness using pace/power and cardiovascular information. [G13][G13] | Notice that today's output is costing more or less effort than usual. | **Model-dependent.** It is session-specific; environmental conditions and sensor quality can influence it. |
| **GA-23 — Race Predictor** | Estimates finish times for standard running distances from fitness and training history. [G31][G31] | Set an initial goal and monitor estimated race preparedness. | **Model-dependent.** An estimate is not a guarantee and does not substitute for course, weather, fueling, or distance-specific preparation. |
| **GA-24 — Real-Time Stamina** | Estimates remaining exercise capacity during supported running/cycling activities, distinguishing current stamina from longer-lasting potential stamina; compatible views show remaining time/distance at the present effort. [G27][G27] [G28][G28] | Pace a sustained effort and avoid spending too much capacity early. | **Model-dependent.** Not a direct fuel-store measurement and not the same as daily Body Battery. |
| **GA-25 — Endurance Score** | Combines relevant activity history into an estimate of sustained-endurance capability and shows contributing sports/changes over time. [G29][G29] | Track endurance development beyond a single running VO₂ max number. | **Model-dependent.** A manufacturer-defined score; not interchangeable with a laboratory endurance test. |
| **GA-26 — Hill Score** | Rates uphill-running capability, including hill strength and hill endurance components derived from running history. [G30][G30] | Identify whether hill-specific ability is improving or needs attention. | **Model-dependent.** Meaningful interpretation requires enough relevant hill-running data. |
| **GA-27 — Heat/altitude acclimation** | Tracks acclimation and adjusts supported fitness interpretations when training in sufficiently hot or high-altitude conditions. The cited manual describes thresholds above **22°C** and **800 m**. [G46][G46] | Avoid interpreting every environment-related performance decrease as lost fitness. | **Model-dependent.** These thresholds describe the documented implementation, not universal physiological boundaries. |
| **GA-28 — Grade-Adjusted Pace** | Displays a pace adjusted for slope in supported running data fields. [G45][G45] | Compare effort on climbs and descents with a flatter-running reference. | **Model-dependent.** Adjustment is not a full correction for technical terrain, wind, temperature, or surface. |

### 3.4 Running mechanics and mechanical-load estimates

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-29 — Cadence and stride length** | Tracks step frequency and distance per step. [G16][G16] | Understand how a pace change was achieved and how gait changed as fatigue accumulated. | **Model-dependent.** Some running dynamics are available from the wrist. |
| **GA-30 — Vertical oscillation, vertical ratio, ground contact time** | Reports vertical movement, movement relative to stride length, and ground-contact duration. [G16][G16] | Inspect mechanical patterns across paces and comparable runs. | **Model-dependent.** Available from wrist or accessory depending on metric/device. Values are observations, not automatic technique diagnoses. |
| **GA-31 — Ground contact time balance** | Shows left/right distribution of ground-contact time. [G16][G16] | Investigate persistent asymmetry or changes during a run. | **Accessory-dependent.** Not an injury diagnosis. |
| **GA-32 — Step Speed Loss** | Estimates how much forward speed is lost at ground contact, with an absolute loss and a percentage-based measure. [G16][G16] | Add information about braking during the stride. | **Selected watches plus HRM 600.** This is not a general capability of all Garmin chest straps. |
| **GA-33 — Running Power** | Estimates running power and provides live, lap, and historical power information. [G16][G16] [G45][G45] | Use another effort target, particularly when pace varies with terrain. | **Model-dependent.** Wrist/accessory support varies; running-power values from different vendors need not be directly comparable. |
| **GA-34 — Running Economy** | Estimates oxygen cost per kilogram per kilometer from compatible running history and physiological/mechanical inputs, including Step Speed Loss. Lower estimated cost represents better economy within this metric. [G15][G15] | Follow an estimated economy trend rather than just running faster. | **Selected watches plus appropriate accessory, such as HRM 600.** Needs qualifying outdoor/track data; not laboratory oxygen-cost measurement. |
| **GA-35 — Running Impact Load** | Expresses running's estimated impact as an equivalent distance relative to easy, flat running, accounting for aspects such as intensity and terrain. [G14][G14] | Distinguish two equal-distance runs that impose different modeled mechanical demands. | **Selected watches.** Different from cardiovascular Exercise Load; does not directly measure tendon, bone, or muscle damage. |
| **GA-36 — Running Tolerance** | Compares accumulated running impact with an individualized tolerance derived from running history. [G14][G14] | Review progression in running-specific demand, not mileage alone. | **Selected watches.** A model-derived tolerance is not a safe injury-prevention limit or permission to ignore pain. |

**Compatibility caution:** A feature documented for one watch is not evidence of support on every model in the same family.

### 3.5 Cycling, strength, and sport-specific records

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-37 — Cycling FTP** | Estimates functional threshold power from qualifying cycling data and supports automatic updates on compatible devices. [G25][G25] | Set power-based training targets and follow threshold development. | **Model-dependent; power-meter data required.** Estimated FTP and a particular laboratory threshold are not automatically identical. |
| **GA-38 — Power Curve** | Shows the best sustained power values for different effort durations from recorded cycling history. [G34][G34] | Distinguish sprint, short-duration, and sustained-power strengths. | **Connect; recorded power required.** A missing maximal effort can make capability appear lower than it is. |
| **GA-39 — Cycling power/efficiency fields** | Compatible activity profiles expose power averages, normalized-power-related fields, and supported pedal/left-right measurements. [G45][G45] | Analyze pacing variability and how pedaling output is distributed. | **Model/accessory-dependent.** The watch cannot manufacture detailed pedal measurements that the paired hardware does not provide. |
| **GA-40 — Strength sets, repetitions, and weights** | Records strength sessions with sets/repetitions and editable exercise/weight details; supported devices count repetitions automatically. [G58][G58] | Track what was actually lifted, not just workout duration or calories. | **Core on compatible strength profiles.** Recognition and counting require correction for some movements. |
| **GA-41 — Targeted muscle maps** | Visualizes muscle groups associated with recorded exercises. [G59][G59] | Review exercise selection and coverage of muscle groups. | **Compatible activities/recognized or edited exercises.** A muscle map describes exercise attribution, not measured local recovery. |
| **GA-42 — Swimming analysis** | Supported swim profiles retain measures such as lengths, strokes, pace, intervals, and SWOLF-related fields. [G45][G45] | Compare interval execution and stroke patterns within the same pool/context. | **Model/profile-dependent.** Pool length and correct lap detection matter; SWOLF comparisons across different pool lengths can mislead. |

### 3.6 Planning, pacing, and turning data into action

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-43 — Custom workouts and training calendar** | Connect allows users to build structured workouts/plans and send them to compatible devices. [G63][G63] | Turn a training intention into explicit steps, targets, and scheduled sessions. | **Core; compatible sport/watch required.** User-authored structure is not automatically adaptive coaching. |
| **GA-44 — Daily Suggested Workouts** | Recommends supported running/cycling sessions using training status/load, recovery, sleep, and recently completed workouts. [G38][G38] | Decide what session to perform next without constructing a complete plan manually. | **Model-dependent.** This is a native recommendation workflow; input/target support differs by device and sport. |
| **GA-45 — Expert-coach running plans** | Offers adaptive running plans associated with Garmin's named human-coach programs; workouts change with the user's performance. [G39][G39] | Follow a structured route to a running goal. | **Core; compatible device.** Distinct from the newer Garmin Run Coach algorithmic plan family. |
| **GA-46 — Garmin Run Coach** | Creates a personalized running plan using the goal/date, available days, and training/health information; adapts as performance and recovery change. [G40][G40] | Connect a long-term goal with changing day-to-day circumstances. | **Model-dependent.** Different from a static downloadable plan or one isolated workout suggestion. |
| **GA-47 — Garmin Cycling Coach** | Provides adaptive cycling plans informed by load, fitness, recovery, and completed workouts. [G39][G39] | Progress toward a cycling event or fitness objective. | **Compatible Garmin setup; power/heart-rate hardware may be needed for full functionality.** |
| **GA-48 — Garmin Triathlon Coach** | Coordinates swimming, cycling, and running progression, with supported strength additions. [G42][G42] | Balance disciplines and their combined demands in one plan. | **Model-dependent.** A multisport plan is different from recording three sports independently. |
| **GA-49 — Strength and Fitness Coach plans** | Strength plans consider goals, target muscles, and available equipment. Fitness-oriented plans prescribe adaptable cardio activity and report progress. [G41][G41] | Make guidance relevant to gym equipment and general-fitness users, not only runners. | **Supported devices/programs.** Exact adaptation differs by plan type. |
| **GA-50 — PacePro** | Creates a pacing strategy for a distance/course, including split targets and hill-aware pacing on supported routes. The watch shows progress against that strategy. [G54][G54] | Turn a finish-time objective into practical pacing guidance. | **Model-dependent; app/web/watch workflow varies.** A pacing strategy is not a statement that the target is physiologically achievable. |
| **GA-51 — Workout Execution Score** | Assesses how closely a structured workout followed its targets. Garmin's detailed explanation weights active steps more than some supporting phases. [G43][G43] [G44][G44] | Separate “completed the workout” from “executed the prescribed intensity.” | **Model-dependent.** Not an effort or fitness score. The detailed weighting reference is an Edge manual; identical weighting across every watch was not independently established. |

### 3.7 Sleep, daily recovery, and physiological trends

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-52 — Sleep duration and stages** | Estimates sleep timing, duration, awake periods, and sleep-stage distribution from overnight wearable signals. [G20][G20] | Review sleep quantity, fragmentation, and recurring schedule patterns. | **Compatible device; overnight wear.** Stage labels are estimates, not polysomnography. |
| **GA-53 — Sleep Score and insights** | Summarizes the night's sleep with a **0–100** score and explanatory feedback. [G61][G61] | Make the night's data easier to interpret at a glance. | **Model-dependent.** A summary score can conceal different causes of a similar result. |
| **GA-54 — Sleep Coach** | Recommends sleep need based on factors including activity, sleep history, HRV, and naps. [G56][G56] | Translate recent demands and rest into a bedtime/sleep-duration planning input. | **Model-dependent.** A recommendation is not a clinical assessment of individual sleep need. |
| **GA-55 — Sleep Alignment** | Compares sleep timing with an estimated internal rhythm and presents alignment-related guidance. [G56][G56] | Distinguish “enough hours” from “consistent/appropriate timing.” | **Selected devices; baseline history required.** Not simply a sleep-duration score. |
| **GA-56 — Nap detection and contribution** | Records supported naps and incorporates them into appropriate recovery/sleep-coaching views. [G19][G19] | Include daytime rest rather than interpreting recovery solely from overnight sleep. | **Model-dependent.** Naps are not identical to a full night's sleep record. |
| **GA-57 — HRV Status** | Compares the **seven-day average** of overnight HRV with a personal baseline established after roughly **three weeks** of wear. [G24][G24] | Identify sustained deviations from the user's usual recovery-related physiology. | **Compatible watch; consistent overnight use.** Compare against personal history, not another person's absolute HRV. |
| **GA-58 — All-day stress** | Estimates physiological stress from heart-rate-variability-related information, with a daily timeline and low/high periods. [G22][G22] | Locate recurring physiological strain and observe rest periods. | **Compatible sensor/wear conditions.** Does not identify an emotion or explain the cause of a stressful period. |
| **GA-59 — Body Battery** | Models available daily energy on a **5–100** scale from sleep, stress, activity, and HRV-related signals, showing recharge and drain. [G23][G23] | Connect daily demands and rest in one accessible timeline. | **Model-dependent.** Not measured glycogen, caloric reserves, or a training-specific clearance score. |
| **GA-60 — Heart-rate history and resting heart rate** | Provides daily and longer-term heart-rate views, including resting-heart-rate trends. [G36][G36] | Notice changes in usual cardiovascular patterns. | **Compatible watch; Connect.** Missing wear and measurement conditions affect the record. |
| **GA-61 — Health Status** | Compares overnight physiological measurements with personal ranges: supported measures include heart rate, HRV, respiration, skin temperature, and Pulse Ox. [G17][G17] | Spot that several signals were unusual relative to the user's baseline. | **Selected devices; approximately three weeks for baseline.** A flagged night is not a diagnosis; available signals vary by hardware. |
| **GA-62 — Health Snapshot** | Performs a short, approximately **two-minute** spot assessment containing supported heart rate, HRV, respiration, stress, and oxygen-saturation results. [G21][G21] | Capture comparable point-in-time wellness observations. | **Model-dependent.** Different from Health Status's overnight baseline comparison. |
| **GA-63 — Respiration and Pulse Ox views** | Shows supported breathing-rate and estimated oxygen-saturation measurements in wellness/activity contexts. [G21][G21] [G35][G35] | Add physiological context to sleep or a spot check. | **Model/sensor/settings-dependent.** Consumer readings should not be treated as comprehensive respiratory screening. |
| **GA-64 — Breathing Variations during sleep** | Uses supported overnight data, including Pulse Ox, to characterize variation in breathing-related patterns. [G35][G35] | Highlight a pattern worth reviewing alongside sleep and symptoms. | **Selected devices; relevant tracking enabled.** Not equivalent to a sleep-apnea diagnosis. |
| **GA-65 — Skin-temperature deviation** | Incorporates supported nighttime skin-temperature measurements into comparison with the user's usual pattern. [G17][G17] | Add context when multiple overnight indicators change together. | **Selected hardware.** Skin temperature is not core temperature, and deviation alone does not identify an illness. |

### 3.8 Health context, behaviors, and nutrition

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **GA-66 — Lifestyle Logging** | Records predefined or custom behaviors and examines their relationships with selected outcomes such as sleep and resting heart rate. [G18][G18] | Explore whether recurring behaviors coincide with better or worse outcomes. | **Compatible Connect/watch workflow.** Treat reported impacts as associations, not causal experiments. |
| **GA-67 — Menstrual cycle and symptom tracking** | Supports cycle records, symptoms, and predictions/educational context within Garmin's women's-health features. [G47][G47] | Keep physiological and subjective context alongside activity and health history. | **Core app; wrist features vary.** Predictions are not contraception or medical confirmation of ovulation. |
| **GA-68 — Pregnancy tracking** | Provides a pregnancy-specific logging and information workflow rather than ordinary period prediction. [G48][G48] | Preserve relevant health context as the user's needs change. | **Core app; compatible wrist workflow.** Not prenatal medical monitoring. |
| **GA-69 — ECG app** | Uses supported electrical sensors to record a short ECG and assess supported rhythm classifications, including signs consistent with atrial fibrillation. [G49][G49] | Capture a rhythm record for an appropriate follow-up conversation. | **Specific hardware, age/eligibility rules, and authorized countries.** Not continuous monitoring for every heart condition or a heart-attack detector. |
| **GA-70 — Fitness Age** | Converts supported fitness and health inputs into an age-like fitness comparison; inputs and calculation differ between implementations. [G55][G55] | Provide a more accessible progress frame than a raw physiological number. | **Model-dependent.** Not biological age, life expectancy, or a diagnosis. |
| **GA-71 — Daily activity, weight, and calorie trends** | Connect retains activity/health history such as steps, intensity minutes, weight, and estimated calories. Additional measurements depend on devices or manual logging. [G36][G36] | Review everyday activity and body-measurement context beyond formal workouts. | **Core.** Watch calorie estimates and scale-derived body composition should not be confused with direct metabolic measurement. |
| **GA-72 — Estimated sweat loss** | Estimates fluid lost during an activity using effort and environmental inputs; appears in the activity's nutrition/hydration section. [G57][G57] | Add an activity-specific starting point for reviewing hydration. | **Compatible activities/devices.** It is a model, not direct measurement of the user's sweat composition. |
| **GA-73 — Nutrition logging** | Connect+ supports food logging and tracking of calories, macronutrients, and other nutrients. Logging includes database/barcode/photo-supported workflows. [G50][G50] [G51][G51] | Keep intake history with training and health data instead of a separate disconnected log. | **Connect+.** Food identification and portion estimates need user review. |
| **GA-74 — Nutrition targets, reports, and interpretation** | Provides personalized intake targets, historical nutrition reports, and relevant Active Intelligence insights. [G51][G51] | Review consistency and potential relationships with training or sleep. | **Connect+.** Does not make an inferred nutrition–sleep association causal or replace individualized clinical nutrition advice. |

## 4. COROS detailed feature catalogue

### 4.1 Workout inspection and the Training Hub analysis environment

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-01 — Activity summary** | The app presents the recorded route, session statistics, charts, laps, and relevant fitness outputs for an activity. [C40][C40] | Review what happened in a session and move from a summary to its component parts. | **Core; app.** Available metrics depend on sport, watch, and connected sensors. |
| **CO-02 — Activity filters and tags** | The activity list supports filters including activity type and tags for notes/RPE or media. [C40][C40] | Retrieve sessions with useful context instead of scrolling through every activity. | **Core; app.** An annotation/tag filter is not an automatic statistical analysis of those annotations. |
| **CO-03 — Four-series workout overlays** | Training Hub can display **up to four metrics together** in the workout analysis view. [C03][C03] | Relate pace/power, heart rate, elevation, and other recorded changes within a session. | **Core; web Training Hub.** Overlaying is within an activity; do not assume arbitrary multi-activity superposition. |
| **CO-04 — Zoom and selection statistics** | Users can zoom into a workout section and inspect statistics for the selected portion. [C03][C03] | Examine a specific climb, interval, finishing surge, or suspicious sensor section. | **Core; Training Hub.** Selection quality depends on recorded data and the question being asked. |
| **CO-05 — Customizable lap analysis** | Training Hub presents lap data with configurable information and links the detailed view to the session. [C03][C03] | Compare repetitions and recovery segments in a structured session. | **Core; Training Hub.** Auto-lap settings and manual lap use influence the resulting segmentation. |
| **CO-06 — Time in zones** | Activity and Hub views summarize time spent in relevant heart-rate/pace/power zones. [C03][C03] [C36][C36] | Check whether easy work remained easy or a threshold session reached its intended intensity. | **Core; relevant signals required.** Zone setup must be appropriate; time in zones is not identical to Training Effect. |
| **CO-07 — Historical dashboards** | Training Hub organizes training history and fitness trends into an athlete dashboard, with charts and summaries over selectable periods. [C02][C02] [C36][C36] | Monitor the relationship between training consistency and performance estimates. | **Core; free Training Hub.** Native dashboard options are not equivalent to an unrestricted analytics database. |
| **CO-08 — Searchable, configurable workout list** | The Hub supports filtering/searching historical workouts and configuring the information shown in the list. [C04][C04] | Find comparable sessions and monitor a chosen set of statistics. | **Core; web.** Older tutorials contain legacy names for some EvoLab metrics. |
| **CO-09 — In-progress activity analysis** | The app can show a full summary of an unfinished activity, updated during pauses, including supported route, lap, pace, and accumulated-load data. [C43][C43] | Analyze a long outing during a break without permanently ending it. | **Supported Resume Later activity modes.** This summary is pause-updated, not continuously live. |
| **CO-10 — Extender** | Mirrors supported live watch data and outdoor route/map information onto the phone. [C46][C46] | Use a larger display during a workout and see current progress. | **Core on compatible devices; phone connection.** Different from CO-09's richer pause-updated summary. |

### 4.2 Training load, stimulus, and recovery modeling

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-11 — Session Training Load** | Assigns an activity a load from duration and intensity, using recorded heart-rate information. [C28][C28] | Compare training stress across different sessions and sports using one framework. | **Core; appropriate heart-rate data.** Cardiovascular load is not a complete account of mechanical or muscular demand. |
| **CO-12 — Weekly load recommendation** | Recommends a seven-day load range from recent training and fitness history; COROS describes a build/recovery-cycle approach. [C01][C01] | Avoid treating every week as an independent target or endlessly increasing volume. | **Core.** A suggested range is not individualized medical clearance. |
| **CO-13 — Base Fitness** | Represents accumulated longer-term training load over approximately **42 days**. [C29][C29] | Understand the amount of training the load model regards as habitual. | **Core.** Despite the name, this is not direct measurement of physiological fitness or race performance. |
| **CO-14 — Load Impact** | Represents shorter-term load over approximately **seven days**. [C30][C30] | See how demanding the current training period is relative to the longer background. | **Core.** An input to the training-status model, not an overnight physiological measurement. |
| **CO-15 — Intensity Trend / Training Status** | Interprets the relationship between short- and long-term load through statuses describing the recent training pattern. [C30][C30] | Identify building, reduced, or potentially excessive recent workload. | **Core.** Older COROS documentation may use “Fatigue”; numerical meanings should not be carried across names without checking. |
| **CO-16 — Recovery score and timer** | Estimates recovery from training using Base Fitness, Training Load, and time/recovery since exercise. COROS explicitly excludes **sleep, HRV, daily stress, and muscular fatigue** from this calculation. [C06][C06] | Help space demanding sessions within its training-load model. | **Core.** Not equivalent to a combined sleep-and-physiology readiness score. |
| **CO-17 — Aerobic and Anaerobic Training Effect** | Rates the session's modeled aerobic and anaerobic stimulus from training load/intensity, using separate numeric scales. [C54][C54] | Distinguish sustained aerobic work from high-intensity contributions. | **Core for supported activities.** These scores describe estimated stimulus, not measured adaptation. |
| **CO-18 — Training Focus** | Assigns a dominant session label: **Easy, Base, Tempo, Threshold, VO₂ Max, or Anaerobic**. [C54][C54] | Check whether a session's actual intensity mix matched its intended role. | **Supported running analytics.** A single label does not describe every part of a mixed workout. |
| **CO-19 — Intensity distribution across training** | Hub views summarize training accumulated across zones over a period, rather than only one activity. [C36][C36] | Review the balance between easy and harder work in a training block. | **Core; Training Hub.** Zone definitions and which activities contain appropriate data affect interpretation. |

### 4.3 Running fitness, efficiency, and testing

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-20 — Running Fitness Score** | Summarizes modeled running ability using qualifying training data and maintains **endurance, threshold, speed, and sprint** subscores. [C16][C16] | See whether development is balanced or concentrated in particular running abilities. | **Core; baseline/qualifying data required.** Not the same as Base Fitness, which summarizes load history. |
| **CO-21 — Running VO₂ max** | Estimates running aerobic capacity and tracks its evolution from running data and user information. [C17][C17] | Follow a fitness trend independently of simple mileage totals. | **Core once unlocked.** Not measured respiratory-gas exchange. |
| **CO-22 — Threshold pace and threshold heart rate** | Estimates running thresholds and supports individualized pace/heart-rate zones. [C18][C18] [C15][C15] | Prescribe workouts at intensities related to current ability rather than generic pace tables. | **Core; qualifying runs or a fitness test.** Default zones and erroneous maximum-heart-rate settings can affect derived results. |
| **CO-23 — Race Predictor** | Estimates time and pace for **5 km, 10 km, half marathon, and marathon**, using roughly the preceding **six weeks** of training. [C53][C53] | Set a provisional goal and monitor distance-specific readiness trends. | **Core once unlocked.** Training relevant to different race distances can influence their predictions differently. |
| **CO-24 — Running Efficiency** | Compares the pace/heart-rate relationship in a run with the user's recent historical pattern. Lower-than-expected efficiency means the recorded output required more cardiovascular effort than expected. [C07][C07] | Detect an unusually costly or unusually strong run and investigate possible context. | **Qualifying data required.** Does not identify the cause and is not a gait/economy test. |
| **CO-25 — Running Fitness Test** | Guides the runner through a structured assessment that establishes/updates Running Fitness, threshold estimates, and relevant heart-rate information. [C15][C15] | Obtain an intentional calibration instead of waiting for ordinary runs to provide sufficient evidence. | **Compatible watch; demanding test.** Requires appropriate conditions and an ability to complete the prescribed effort safely. |
| **CO-26 — Effort Pace** | Converts terrain-affected pace into a personalized flat-equivalent effort reference, using historical relationships between pace, heart rate, and gradient. [C22][C22] | Pace hills more consistently and compare uneven routes more intelligently. | **Compatible running modes.** It does not fully adjust for weather, altitude, or technical surface difficulty. |
| **CO-27 — Running Power** | Provides estimated running-power data in supported running profiles for live guidance and post-run inspection. [C21][C21] [C22][C22] | Use an additional intensity reference when pace alone is difficult to interpret. | **Compatible watches.** Not interchangeable with every other manufacturer's running-power scale. |
| **CO-28 — Advanced running dynamics** | Adds gait measures such as ground time, left/right balance, stride height/ratio, and related mechanics. [C21][C21] | Examine mechanical changes across sessions or parts of a run. | **Metric-specific hardware requirements.** Waist-worn COROS POD measurements are different from foot-worn pace assistance. |
| **CO-29 — Running Form Test** | A roughly **10-minute outdoor test** combines warm-up and steady running, then provides a form assessment, gait classification, component results, and recommendations. [C20][C20] | Establish a repeatable mechanics-oriented assessment and review its components. | **COROS POD 1 or POD 2 worn at the waist.** Manufacturer injury/economy language should not be taken as independently validated clinical risk prediction. |

**Unlocking is itself an important UX detail.** COROS documents an initial qualifying run of at least 25 minutes at sufficient heart-rate reserve, or a Running Fitness Test, to establish running metrics. The May 2026 update additionally states that indoor runs can affect Running Fitness, race predictions, and threshold zones. Therefore, the older shorthand “only outdoor runs ever affect running fitness” is no longer reliable. [C18][C18] [C14][C14]

### 4.4 Cycling performance and sensor-dependent analysis

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-30 — Cycling FTP estimate** | Estimates functional threshold power from qualifying cycling power and heart-rate data, with a historical fitness view. [C24][C24] | Follow sustained cycling capability and set power-based targets. | **Power meter plus heart-rate data for the full feature.** General Training Load can exist without unlocking FTP. |
| **CO-31 — Guided FTP Test** | Provides an indoor cycling assessment to establish/update FTP. [C19][C19] | Recalibrate targets intentionally rather than relying only on passive updates. | **Compatible trainer/power and heart-rate setup.** Testing conditions and pacing influence results. |
| **CO-32 — Cycling power zones** | Uses the FTP estimate to establish individualized intensity zones and supports power-based workout targeting. [C24][C24] | Translate watts into actionable training intensity. | **FTP/power data required.** Correct threshold calibration matters more than the presence of a colorful zone chart. |
| **CO-33 — Cycling Efficiency** | Compares the power/heart-rate relationship of a qualifying ride with expected performance. [C26][C26] | Investigate rides that felt unusually demanding or showed unusually strong output. | **Power and heart rate; qualifying duration/intensity.** This is not pedal-stroke efficiency or direct metabolic efficiency. |
| **CO-34 — Maximum Mean Power curve** | Displays the highest mean power sustained over durations from **one second to four hours**, with historical/recent comparisons. [C23][C23] | Find strengths, weaknesses, and changes across sprint and endurance durations. | **Power-meter recordings.** Reflects best recorded efforts, not necessarily maximum possible ability. |
| **CO-35 — Cycling VO₂ max** | Estimates cycling aerobic capacity from personal information, FTP, and rides containing power/heart-rate data. The app shows history in the Cycling FTP card; the watch can show the current value. [C27][C27] | Follow a cycling-specific fitness trend. | **Documented September 2026; compatible firmware/data.** Do not omit it based on an older COROS feature comparison. |
| **CO-36 — Advanced pedal metrics in the wider ecosystem** | COROS documents left/right balance, torque effectiveness, and pedal smoothness with compatible power-meter data on **DURA**. [C60][C60] | Examine distribution and characteristics of pedaling output. | **DURA/accessory-specific evidence.** Do not generalize this to every COROS watch. |

**Calibration distinction:** COROS's cycling documentation separates ordinary heart-rate-derived training metrics from advanced cycling-fitness metrics that need qualifying power-plus-heart-rate sessions. A user seeing Training Load after a ride does not prove that FTP, Cycling Efficiency, and Cycling VO₂ max have all been established. [C25][C25]

### 4.5 Planning, pacing, and coaching workflows

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-37 — Structured workouts** | Lets users follow step-based workouts with prescribed duration/distance/intensity and recovery phases on compatible watches. [C31][C31] | Execute the planned session and create meaningful interval data for review. | **Core; sport/model-dependent targets.** A workout can be self-authored, library-based, or coach-provided. |
| **CO-38 — Training calendar and plan management** | Training Hub supports scheduling and moving workouts, repeating/copying plans or weeks, and organizing training phases. [C04][C04] | Manage a coherent block rather than isolated workouts. | **Core; app/web capabilities differ.** A scheduled plan is not necessarily automatically reoptimized after each night. |
| **CO-39 — Planned-load forecasting** | Hub planning can display projected load-related trends using workouts scheduled in the calendar. [C04][C04] | See how a proposed block would change modeled load before completing it. | **Core; planned workout estimates required.** Forecasts assume the plan is followed and do not guarantee physiological adaptation. |
| **CO-40 — Personalized Marathon Plans** | Builds a plan from recent mileage, estimated or supplied race performances, target time/date, and desired intensity; the user can inspect weekly distance/time/load and move workouts. [C37][C37] | Turn a marathon goal into a personalized progression and taper. | **Core.** Personalization at creation is not evidence of Garmin-style daily sleep/HRV-driven automatic replanning. |
| **CO-41 — Coach and team Training Hub** | Authorized coaches can inspect athlete histories, review training, assign workouts/plans, and monitor a roster. [C05][C05] | Give a human coach direct access to longitudinal evidence and plan execution. | **Native Hub; coach enrollment/athlete authorization.** A human coaching service may have separate arrangements. |
| **CO-42 — Training feedback and comments** | Athletes/coaches can retain workout feedback and discussion within the training workflow. [C05][C05] | Keep subjective context near the session it explains. | **Core where the workflow supports it.** Notes are not automatically incorporated into every EvoLab score. |
| **CO-43 — Pace Strategy creation** | Builds a pacing plan from a distance or route using running fitness and elevation; supports manual target/split changes and planned waypoint-stop durations. [C50][C50] | Translate a finish-time goal into section-by-section effort and aid-station planning. | **Compatible devices; route data for route-aware features.** Long/technical-event forecasts require judgment. |
| **CO-44 — Live Pace Strategy guidance** | Displays target pace, estimated finish, ahead/behind status, and relevant waypoint progress while following the plan. [C50][C50] | Make pacing corrections during the event. | **Supported run/trail/hike workflows.** Dynamic ETA changes are not new measurements of fitness. |
| **CO-45 — Planned-versus-actual pacing review** | The activity summary compares achieved paces with the Pace Strategy targets. [C50][C50] | Learn whether time was lost through pacing, sections of terrain, or stops. | **Requires a recorded Pace Strategy session.** Not the same as an automatically computed explanation of the cause. |
| **CO-46 — Hill Alerts** | Detects upcoming climbs/descents on a followed route and shows progress through the current segment. [C52][C52] | Anticipate effort changes rather than reacting after a climb begins. | **Compatible watch, route, and firmware.** A pacing aid rather than a longitudinal fitness score. |
| **CO-47 — TrainingPeaks integration** | Imports supported TrainingPeaks plans/workouts into the COROS training workflow. [C45][C45] | Keep an external coach's prescription synchronized with the recording device. | **External account/service.** Connection does not imply that every TrainingPeaks analytic is native to COROS. |

### 4.6 Sleep, recovery-related physiology, and daily health

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-48 — Sleep timing and stages** | Records sleep sessions and estimates awake, light, deep, and REM-related periods, with daily and historical views. [C09][C09] | Inspect duration, fragmentation, and recurring patterns. | **Compatible watch; overnight wear.** Sleep stages are estimates, not a laboratory sleep study. |
| **CO-49 — Sleep Score** | A **0–100** score incorporates total sleep time, deep/REM proportions, wakefulness, bedtime consistency, and sleep stress. [C08][C08] | See both an overall sleep assessment and its contributing dimensions. | **Current compatible firmware; documented in the August 2026 update.** Older “COROS has no sleep score” comparisons are outdated. |
| **CO-50 — Bedtime consistency** | Compares bedtime with the user's recent pattern after establishing sufficient history. [C08][C08] | Identify schedule irregularity separately from total hours slept. | **Part of updated sleep analytics.** Consistency and Garmin's modeled Sleep Alignment are not the same calculation. |
| **CO-51 — Naps and timed naps** | Detects daytime sleep and offers a timed-nap workflow. Naps contribute to daily total sleep time, while individual naps do not receive the same stage/quality assessment as main sleep. [C58][C58] | Include daytime rest in the sleep record. | **Compatible devices.** Main-sleep classification and minimum duration rules affect which assessments appear. |
| **CO-52 — Sleep record editing** | Current sleep tools allow correction of recorded sleep, including supported additions, adjustments, or combining sessions. [C09][C09] [C10][C10] | Fix obvious detection errors rather than accepting incorrect history indefinitely. | **App/firmware-dependent.** Editing/merging can alter score inputs; time between combined sessions may count as awake. |
| **CO-53 — Overnight HRV** | Establishes a personal normal range after approximately **five nights** and presents overnight HRV and historical trends. [C11][C11] | Identify deviations relative to the user's own physiology. | **Compatible watches; consistent sleep recording.** Displaying HRV does not mean the Recovery calculation uses it. |
| **CO-54 — Daily Stress** | Estimates stress from heart rate and HRV-related signals and shows a timeline. The app can exclude activity stress from the displayed view. [C13][C13] | Separate exercise-related strain from non-exercise patterns for investigation. | **Compatible devices/settings.** The watch view may still include activity stress; the score does not identify emotions. |
| **CO-55 — Daily and resting-heart-rate history** | Provides daily heart-rate patterns, resting-heart-rate records, and updated views separating sleep/exercise-related trends. [C10][C10] [C55][C55] | Notice shifts in the user's usual pattern or the relationship with training. | **Core on compatible devices.** Consistent wear and comparable measurement conditions matter. |
| **CO-56 — Wellness Check** | A short spot assessment reports supported heart rate, HRV, stress, breathing rate, and SpO₂. Current HRV results use an absolute HRV measure rather than the older normalized HRV Index. [C12][C12] | Capture a deliberate moment-in-time physiological check. | **Model-dependent optical/electrical hardware.** Electrical sensing here is not equivalent to an ECG rhythm-classification app. |
| **CO-57 — Post-exercise Heart Rate Recovery** | Measures the decline in heart rate over **two minutes** after the final activity pause/end, with a graph in the app and a live watch preview while paused. [C47][C47] | Review how heart rate settled after a session under comparable conditions. | **Documented June 2026; compatible firmware.** Not the same metric as EvoLab Recovery. |
| **CO-58 — Interval Heart Rate Recovery** | Records heart-rate recovery during rest phases in supported structured runs/Basic Interval sessions and adds it to lap details. [C47][C47] | Compare recovery behavior between repetitions within a workout. | **Supported running workflows.** Rest duration, posture, movement, and sensor gaps influence comparisons. |
| **CO-59 — Menstrual cycle and symptom tracking** | Logs periods, flow/cramps, other symptoms, and notes; supports cycle history and predictions for upcoming cycles. [C49][C49] | Retain health context and observe recurring patterns. | **Core app; watch presentation supported on selected models.** Not medical confirmation of fertility or contraception. |
| **CO-60 — Everyday activity trends** | Tracks daily steps, activity time, and estimated activity calories alongside training-related information. [C55][C55] | See the difference between formal workouts and general daily movement. | **Core.** Do not compare calorie figures across platforms without checking whether they include resting metabolism. |

### 4.7 Strength training, subjective context, and specialist sensors

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-61 — Strength logs and correction tools** | Records exercises/sets/repetitions/intensity, supports editing reps and weights, and permits reordering exercises during a session. Unstructured sessions support additional set/time corrections. [C14][C14] | Keep a realistic gym log when equipment availability or automatic counting changes the session. | **Compatible watch/app firmware.** A detected or assumed repetition count still needs review. |
| **CO-62 — Muscle heatmap and custom exercises** | Associates recorded/custom exercises with primary and secondary muscles; edits to the exercise record update the heatmap. [C14][C14] | Review exercise distribution and whether the recorded workout reflects intended muscle groups. | **Native strength workflow.** Not direct local-muscle recovery or muscle-damage measurement. |
| **CO-63 — Voice training notes and RPE** | On microphone-equipped supported watches, the athlete records a post-workout voice note and selects perceived exertion. Audio/transcription and RPE appear in the app and are available to an authorized coach. [C48][C48] | Capture how the workout felt before the context is forgotten. | **Selected hardware**, including documented PACE 4/APEX 4/NOMAD configurations. Not evidence that RPE alters the load/recovery algorithm. |
| **CO-64 — Adventure Journal** | Adds route-linked photos, video, and supported voice/location notes to an activity. [C42][C42] | Preserve context about terrain, conditions, stops, and the experience itself. | **App/device-dependent.** A contextual activity journal, not a native behavior–sleep causal analysis tool. |
| **CO-65 — Gear Tracking** | Tracks accumulated distance for shoes/bikes, supports automatic assignment by activity type, and offers supported distance-limit notifications. [C56][C56] | Compare experience across equipment and manage replacement/maintenance reminders. | **Core.** Mileage thresholds are user/gear-management choices, not precise material-fatigue measurements. |
| **CO-66 — Pool-swim structure** | Supports drills and regular/send-off-time interval workflows, improving how swim sets are prescribed and segmented. [C59][C59] | Review a session as swim sets instead of one undifferentiated block. | **Compatible pool-swim profiles.** Correct pool length and recording behavior remain important. |
| **CO-67 — CORE temperature-sensor integration** | Displays and records a paired CORE sensor's temperature data, including a post-activity curve. [C57][C57] | Add temperature context to training in heat. | **External accessory.** Not a native wrist-only core-temperature measurement; accuracy claims require separate validation. |
| **CO-68 — AbsolutSweat integration** | Displays and stores supported sweat-rate/electrolyte-loss data from a compatible AbsolutSweat hydration sensor. [C51][C51] | Connect specialized hydration measurements with the activity timeline. | **External sensor; supported watches/firmware.** Different from Garmin's formula-based Estimated Sweat Loss. |

### 4.8 AI-assisted access and analysis

| ID / feature | What it does and what data it uses | User value | Surface / dependencies / limits |
|---|---|---|---|
| **CO-69 — Authorized AI access through COROS MCP** | COROS provides a connection allowing compatible external AI tools to query actual training and health history and construct analyses or dashboards. [C33][C33] | Ask natural-language questions that go beyond fixed native dashboard cards. | **External.** This is an access/analysis layer, not a new native COROS readiness algorithm. |
| **CO-70 — AI-created workouts and plans** | The official guide documents creation/editing of road-running, trail-running, and cycling workouts/plans, with synchronization to COROS libraries/calendar. [C32][C32] | Turn analysis into a structured prescription without manual re-entry. | **External; authorized writes.** Current documented limits include 4–16-week plans, restricted scheduling windows, and manual deletion in the app. AI output still needs user review. |

The September 2026 MCP guide lists activity/lap records, training feedback, FIT files, sleep, heart rate, HRV, stress, Wellness Checks, menstrual data, training metrics, and selected profile/device data. FIT retrieval has a documented request limit. The external AI service's account limits, availability, and privacy rules are separate from COROS's native app. This catalogue records the integration's existence; it is not a setup guide or an endorsement of any generated training or health conclusion. [C32][C32]

## 5. Important differences hidden by similar names

### 5.1 Recovery, readiness, and heart-rate recovery are different products

| Concept | What it answers | Relevant catalogue entries |
|---|---|---|
| **Recovery from accumulated exercise** | “How much recovery does this training-load model estimate I still need?” | Garmin Recovery Time; COROS Recovery. |
| **Current readiness incorporating broader recovery context** | “Do training and overnight/daily indicators collectively support a demanding session?” | Garmin Training Readiness. COROS sleep/HRV should be reviewed separately from its load-based Recovery. |
| **Heart-rate recovery after an effort** | “How quickly did my recorded heart rate decrease during this recovery period?” | COROS post-session and interval Heart Rate Recovery. |
| **Daily energy reserve model** | “How have everyday demands and rest affected the model's estimate of available energy?” | Garmin Body Battery. |
| **Sleep assessment** | “What does the wearable estimate about the quantity, structure, and timing of sleep?” | Both ecosystems' sleep analytics. |

These are interpretations of the documented features, not interchangeable measurements of a single biological quantity. [G60][G60] [G11][G11] [G23][G23] [C06][C06] [C47][C47]

**Illustrative scenario, not medical advice:** After poor sleep but very little recent training, a load-based Recovery value could look favorable while an overnight-physiology or sleep measure looks unfavorable. That need not be a software contradiction: the systems are answering different questions.

### 5.2 “Fitness” can mean training history or estimated performance

**COROS Base Fitness** is a longer-term load-model quantity. **COROS Running Fitness** estimates running ability. Those can move differently: a user can accumulate workload without proving improved race performance. Garmin's **Training Status** explicitly tries to interpret load in relation to estimated fitness changes. [C29][C29] [C16][C16] [G62][G62]

For a competitive feature spreadsheet, use separate columns for **training input**, **physiological response**, and **performance outcome**. Otherwise, an attractive upward load chart may be mistaken for evidence that a program worked.

### 5.3 Running Efficiency is not Running Economy

COROS **Running Efficiency** concerns the relationship between recorded pace and cardiovascular effort in a particular run relative to prior runs. Garmin **Running Economy** estimates oxygen cost per unit distance with additional physiological/mechanical inputs. COROS's **Running Form Test** is a third category: an active mechanics assessment. [C07][C07] [G15][G15] [C20][C20]

A useful product comparison should therefore distinguish **session performance**, **estimated energetic cost**, and **movement mechanics** rather than put them all under “running efficiency.”

### 5.4 A pacing plan is not a fitness prediction

Garmin PacePro and COROS Pace Strategy help operationalize a selected race target. COROS also provides explicit planned-versus-actual pacing review. A user can still select an unrealistic target; successful construction of the plan is not evidence that it is achievable. [G54][G54] [C50][C50]

### 5.5 A journal is not automatically an experiment

Garmin Lifestyle Logging is intended to associate logged behaviors with selected outcomes. COROS training notes and Adventure Journal preserve subjective/contextual information. These are valuable but different capabilities. [G18][G18] [C48][C48] [C42][C42]

**Analyst interpretation:** An association display still needs sufficient observations and attention to competing explanations. A note saying “late meal” alongside poor sleep does not isolate the meal from travel, alcohol, hard exercise, illness, or irregular timing. A feature that makes those uncertainties visible would be more trustworthy than an unexplained percentage “impact.”

## 6. Access, subscriptions, sensors, and data portability

### 6.1 Free versus paid is feature-specific

| Area | Garmin | COROS |
|---|---|---|
| Native activity history and routine analytics | Core Connect account; compatible recording hardware determines many available metrics. [G63][G63] | Native app/EvoLab and free Training Hub. [C02][C02] |
| More flexible analysis/personalized interpretation | Connect+ adds Performance Dashboard and Active Intelligence. [G06][G06] [G08][G08] | Additional conversational/custom analysis can use an external AI service through COROS's authorized connection. [C33][C33] |
| Native food/nutrient tracking | Current nutrition feature is Connect+. [G50][G50] | Equivalent native daily food/macronutrient diary was not verified; specialist sweat-sensor integration is a different feature. [C51][C51] |
| Human-coach workflow | Native training plans exist, but they should not be equated with a coach managing an athlete roster. [G39][G39] | Native coach/team Training Hub workflow. [C05][C05] |
| Hardware-specific metrics | Buying Connect+ does not provide a missing physical sensor or unlock every watch-only metric. | Using an AI connector does not create measurements the watch/sensors did not record. |

Prices are intentionally omitted: subscription pricing, taxes, promotions, eligibility, and AI-provider charges vary. The relevant comparison is which capability requires a paid layer, not a potentially misleading single global price.

### 6.2 Common sensor and history dependencies

| Measurement family | Dependency to check before calling it “supported” |
|---|---|
| Running mechanics | Verify the source of each value: wrist, foot pod, waist pod, or chest strap. [G16][G16] [C21][C21] |
| Garmin Step Speed Loss / Running Economy | Selected watches and the appropriate advanced accessory; a generic heart-rate strap is not sufficient evidence of support. [G15][G15] [G16][G16] |
| COROS Running Form Test | Compatible watch plus COROS POD 1/2 worn as instructed. [C20][C20] |
| Advanced cycling metrics | Power data, heart-rate data, sufficient qualifying efforts, and supported recording hardware. [G25][G25] [C25][C25] |
| Sleep/HRV/personal baselines | Regular wear, sufficient nights, clean data, and the correct device/account setup. [G24][G24] [C11][C11] |
| ECG | Authorized model and region, plus the feature's eligibility rules; generic HRV/electrical sensing is insufficient. [G49][G49] [C12][C12] |
| Specialized sweat/core temperature | An external sensor is part of the measurement chain; do not present it as a watch-only measurement. [C51][C51] [C57][C57] |

### 6.3 Export, import, and synchronization

| Workflow | What is documented | Why it matters / limitation |
|---|---|---|
| **Garmin activity export** | Connect provides supported activity exports, including original and common exchange formats where applicable. [G32][G32] | Enables external analysis. A route-only export does not contain the same information as a full activity file. |
| **Garmin health/account export** | Garmin documents separate options for exporting activity and wellness/account information. [G32][G32] | Being able to export a workout does not establish access to every daily health series or proprietary score. |
| **Garmin Unified Training Status** | The account can designate a Primary Training Device and Primary Wearable, coordinating activities and performance information across compatible Garmin devices. [G52][G52] [G53][G53] | A ride recorded on an Edge and sleep recorded on a watch can participate in one ecosystem history. Device priority and synchronization matter. |
| **COROS individual export** | The app provides individual workout export for transfer to external tools. [C41][C41] | Supports analysis outside native charts. Choose a format based on the required data, not just file size. |
| **COROS bulk workout export** | Training Hub provides self-service historical activity export, with FIT/TCX options and delivery of the export. [C39][C39] | Useful for migration or a longitudinal research dataset. |
| **COROS daily/health bulk export** | The documented bulk-export guidance directs requests for sleep and other non-activity data to support. [C38][C38] | This is a different workflow from self-service workout export. MCP access is another route for supported queries, not necessarily a complete archival export. |
| **COROS activity import** | Supports importing compatible historical activity files, including FIT/TCX workflows. [C44][C44] | Helps preserve prior training. Do not assume importing a workout reconstructs every proprietary score or all daily-health history. |
| **COROS third-party synchronization** | Supports authorized connections to listed external training services. [C34][C34] | Check the direction of sync, data types, and historical backfill separately; “integrates” is not a complete specification. |
| **COROS activity correction/recovery** | Supports changing an eligible saved activity's type and recovering recently deleted activities through the relevant app workflow. [C35][C35] [C40][C40] | Data hygiene is an analytical feature: mislabeled or missing sessions can undermine later comparisons. |

**Privacy implication — analyst assessment:** A feature comparison should include permissions and reversibility. Activity routes, health patterns, cycle records, and voice notes can be sensitive. External analysis should make clear which data is shared, whether the connection can write training plans, and whether disconnecting access also deletes data already transferred.

## 7. Which capabilities are useful: product assessment

The following priorities are analytical judgments, not additional manufacturer claims or a validated ranking of health outcomes.

### 7.1 Highest-value foundations

| Capability | Why I would prioritize it | Existing examples to study |
|---|---|---|
| **Detailed workout inspection with correct segmentation** | It lets the athlete answer a concrete question: “Did I perform the intended session?” It remains useful even when a proprietary score is wrong. | GA-01/02/03; CO-03/04/05. |
| **Context-aware longitudinal comparisons** | “Am I improving?” requires comparable activities and conditions, not merely more kilometers or a rising load score. | Garmin period comparisons; COROS historical dashboards and efficiency trends. |
| **Readiness with visible contributing factors** | Users need to understand why a recommendation changed and which part conflicts with how they feel. | Garmin Training Readiness; the deliberate separation between COROS Recovery and its sleep/HRV views. |
| **Data correction and portable history** | An advanced model is less useful when users cannot fix an obviously wrong activity or take their history elsewhere. | Garmin activity editing/export; COROS sleep/strength corrections and bulk workout export. |
| **Recommendations tied to a goal and calendar** | A suggestion becomes much more actionable when it explains what to do today and how that fits the larger plan. | Garmin Coach/DSW; COROS plans, calendar, coaching, and pacing workflows. |

### 7.2 Particularly valuable for specific users

**Self-coached endurance athletes:** Prioritize lap/selection analysis, threshold calibration, intensity distribution, training-block comparison, and explainable planning. A large metric catalogue is less important than a coherent workflow from the last session to the next week's decisions.

**Athletes working with a coach:** Prioritize plan assignment, compliance, comments, subjective feedback, and quick identification of sessions needing review. COROS's voice-note-to-coach workflow is a useful pattern: reduce the effort of supplying context, rather than asking an athlete to fill out a long questionnaire.

**Health-focused users:** Prioritize sleep regularity, personal physiological baselines, clear distinctions between wellness and medical functions, and conservative interpretation of unusual readings. A “normal for you” range may be easier to act on than a population leaderboard.

**Strength/hybrid athletes:** Prioritize accurate exercise/rep/load records, editable sessions, muscle-group coverage, soreness/pain context, and explicit acknowledgment that cardiovascular load is not the whole workload. Do not position a muscle heatmap as recovery measurement.

**Trail and ultra athletes:** Prioritize terrain-aware pacing, waypoint/aid-station planning, selected-section analysis, in-progress review, and the ability to add context. Forecast uncertainty becomes especially important as terrain and duration diverge from the user's recorded history.

### 7.3 Opportunities beyond another score

| Product opportunity | Concrete behavior a product could provide | What must be made explicit |
|---|---|---|
| **Explain changes with comparable evidence** | “Your last four comparable easy runs were slower at similar heart rate; two were much warmer. There is insufficient evidence yet to attribute this to declining fitness.” | Which sessions were compared, what was controlled, and which explanations remain possible. |
| **Separate training input, response, and outcome** | Show training completed, recovery response, and changes in comparable performance as distinct layers. | A rising load-model quantity is not automatically a positive performance outcome. |
| **Explain conflicting indicators** | “Training load is low, but overnight signals are unusual; that is why the recommendation is conservative.” | Which score uses which data, and which important factors it does not use. |
| **Support low-friction subjective context** | Let users add “poor sleep,” “sore calves,” or “session felt easier” by a quick selection or voice note, then show where the information affected guidance. | Whether subjective input is merely stored or actually used in the recommendation. |
| **Evaluate whether advice helped** | After a suggested change, compare the subsequent outcome with a reasonable baseline and report uncertainty. | Correlation, missing data, concurrent changes, and regression to the mean. |
| **Make evidence quality visible** | Show whether a score comes from clean recent data, a stale estimate, sparse history, or an external sensor. | Confidence/freshness should be visible at the point where the decision is made. |

The strongest differentiation would be a dependable chain from **observation → interpretation → action → outcome review**, not simply a greater number of proprietary metrics.

## 8. Limitations and questions for hands-on validation

### 8.1 What this research establishes

The cited official pages establish documented capability, intended meaning, and stated dependencies. They do **not** independently establish measurement accuracy, superior coaching outcomes, clinical validity, ease of use, or complete feature parity across devices.

This is a broad analytics inventory, not an exhaustive list of every screen, sport profile, firmware variant, alert, or third-party extension. Features are deliberately split where their purpose differs; the number of catalogue entries is **not** a score of product quality or breadth.

### 8.2 Naming and release traps

Older COROS tutorials use names such as **Marathon Level**, **Running Performance**, or **Fatigue** where newer documentation uses Running Fitness, Running Efficiency, or Intensity Trend-related terminology. Use current feature definitions rather than mechanically matching historical names. [C03][C03] [C04][C04] [C16][C16] [C07][C07]

Several important current capabilities have changed since older comparisons: COROS's updated sleep analysis, Heart Rate Recovery, Pace Strategy, cycling-fitness additions, and AI connection; Garmin's evolving Coach and Connect+ offerings. Update dates are evidence that documentation changed, not proof that every device received a feature on that day. [C10][C10] [C47][C47] [C52][C52] [C27][C27] [C32][C32] [G39][G39] [G07][G07]

### 8.3 High-value tests for a hands-on follow-up study

| Test | What it would resolve |
|---|---|
| Record the same interval session, then inspect laps/selected sections on phone and web. | Which interface actually supports an athlete's investigation efficiently? |
| Correct an activity type, repetition count, or sleep window. | Which downstream charts/scores update, and which remain unchanged? |
| Compare a normal night, short night, and high-load day. | Can the user see why readiness/recovery changed and why different scores disagree? |
| Stop wearing the watch or leave a sensor unpaired. | Does the product expose missing/stale data rather than displaying unjustified precision? |
| Export a month of workouts and daily health history. | Which fields, sampling rates, proprietary scores, and annotations are actually portable? |
| Import external activities and synchronize a second device. | Which models incorporate imported data and how are duplicates handled? |
| Enter contradictory subjective feedback. | Is it only a note, or does it affect coaching/recommendations? |
| Compare identical accounts on two model tiers and with/without subscription. | Which capabilities are hardware-gated, software-gated, subscription-gated, or simply displayed differently? |

### 8.4 Health and safety interpretation

Do not treat a favorable score as permission to ignore symptoms or pain. Likewise, a single unusual reading does not identify its cause. Product-specific ECG, wellness-check, and breathing features have different intended uses and limitations; their existence should not be conflated with comprehensive medical screening. [G49][G49] [G21][G21] [G35][G35] [C12][C12]

## 9. Source register

All links below point to official Garmin or COROS pages used in the research. Research access date: **October 15, 2026**. Documentation can change after this snapshot. Some URLs retain a regional path or older device/manual name even when they describe a capability still relevant to the ecosystem.

### Garmin sources

- **G02** — [Saved activity details][G02]
- **G03** — [Comparing activities][G03]
- **G04** — [Garmin Connect reports][G04]
- **G05** — [Personal records][G05]
- **G06** — [Performance Dashboard][G06]
- **G07** — [Garmin Connect+ subscription][G07]
- **G08** — [Active Intelligence][G08]
- **G09** — [Training Load][G09]
- **G10** — [Training Status explanation][G10]
- **G11** — [Training Readiness][G11]
- **G12** — [Training Effect][G12]
- **G13** — [Performance Condition][G13]
- **G14** — [Running Tolerance][G14]
- **G15** — [Running Economy][G15]
- **G16** — [Running Dynamics and Running Power][G16]
- **G17** — [Health Status][G17]
- **G18** — [Lifestyle Logging][G18]
- **G19** — [Sleep tracking and Sleep Coach][G19]
- **G20** — [Garmin sleep tracking support][G20]
- **G21** — [Health Snapshot][G21]
- **G22** — [Stress Level][G22]
- **G23** — [Body Battery][G23]
- **G24** — [Heart Rate Variability Status][G24]
- **G25** — [Automatic performance measurement detection][G25]
- **G26** — [Lactate Threshold][G26]
- **G27** — [Real-Time Stamina][G27]
- **G28** — [Real-Time Stamina watch display][G28]
- **G29** — [Endurance Score][G29]
- **G30** — [Hill Score][G30]
- **G31** — [Predicted race times][G31]
- **G32** — [Data exports][G32]
- **G33** — [Activity editing][G33]
- **G34** — [Power Curve][G34]
- **G35** — [Breathing Variations][G35]
- **G36** — [Garmin Connect health and wellness overview][G36]
- **G37** — [Training Load Focus in performance measurements][G37]
- **G38** — [Daily Suggested Workouts][G38]
- **G39** — [Five ways to use Garmin Coach (June 2026)][G39]
- **G40** — [Garmin Run Coach][G40]
- **G41** — [Garmin Strength and Fitness Plans][G41]
- **G42** — [Garmin Triathlon Coach][G42]
- **G43** — [Workout Execution Score: Forerunner 265 manual][G43]
- **G44** — [Workout Execution Score explained: Edge 850 manual][G44]
- **G45** — [Forerunner 970 data fields][G45]
- **G46** — [Heat and altitude performance acclimation][G46]
- **G47** — [Women's health tracking][G47]
- **G48** — [Pregnancy tracking][G48]
- **G49** — [ECG app][G49]
- **G50** — [Nutrition tracking][G50]
- **G51** — [Nutrition tracking launch, January 2026][G51]
- **G52** — [Primary Training Device][G52]
- **G53** — [Unified Training Status and device sync][G53]
- **G54** — [PacePro][G54]
- **G55** — [Fitness Age][G55]
- **G56** — [Sleep Coach and Sleep Alignment][G56]
- **G57** — [Estimated sweat loss][G57]
- **G58** — [Strength training activity analysis][G58]
- **G59** — [Targeted muscle maps][G59]
- **G60** — [Recovery Time calculation][G60]
- **G61** — [Top ten health-monitoring features][G61]
- **G62** — [Training Status support][G62]
- **G63** — [Garmin Connect analysis and free account][G63]

### COROS sources

- **C01** — [COROS Fitness Metrics Explained][C01]
- **C02** — [Training Hub overview][C02]
- **C03** — [Training Hub Athlete Tutorial][C03]
- **C04** — [Training Hub Manual][C04]
- **C05** — [Training Hub Coaches Tutorial][C05]
- **C06** — [Recovery Widget][C06]
- **C07** — [Running Efficiency][C07]
- **C08** — [Sleep Score][C08]
- **C09** — [Sleep tracking][C09]
- **C10** — [August 2026 feature update][C10]
- **C11** — [Overnight HRV][C11]
- **C12** — [Wellness Check][C12]
- **C13** — [Daily Stress][C13]
- **C14** — [May 2026 feature update][C14]
- **C15** — [Running Fitness Test][C15]
- **C16** — [Running Fitness Score][C16]
- **C17** — [Running VO2 Max][C17]
- **C18** — [Receive and update running fitness metrics][C18]
- **C19** — [FTP Test][C19]
- **C20** — [Running Form Test][C20]
- **C21** — [Advanced Running Metrics][C21]
- **C22** — [Activity tracking and settings / Effort Pace][C22]
- **C23** — [Maximum Mean Power Curve][C23]
- **C24** — [Cycling Fitness Metrics][C24]
- **C25** — [Cycling fitness requirements][C25]
- **C26** — [Cycling Efficiency][C26]
- **C27** — [Cycling VO2 Max][C27]
- **C28** — [Training Load][C28]
- **C29** — [Base Fitness][C29]
- **C30** — [Interpreting Training Status][C30]
- **C31** — [Structured workouts][C31]
- **C32** — [Connect COROS to AI][C32]
- **C33** — [Official MCP introduction][C33]
- **C34** — [Supported third-party apps][C34]
- **C35** — [Change saved workout activity type][C35]
- **C36** — [Welcome to Training Hub][C36]
- **C37** — [Personalized Marathon Plans][C37]
- **C38** — [Bulk activity and health-data export access][C38]
- **C39** — [Bulk activity export workflow][C39]
- **C40** — [Activities Page and Activity Summary][C40]
- **C41** — [Single-workout export][C41]
- **C42** — [Adventure Journal][C42]
- **C43** — [In-progress activity analysis][C43]
- **C44** — [Importing activities][C44]
- **C45** — [TrainingPeaks plan integration][C45]
- **C46** — [Extender live phone display][C46]
- **C47** — [Heart Rate Recovery][C47]
- **C48** — [Voice training notes and RPE][C48]
- **C49** — [Menstrual Cycle Tracking][C49]
- **C50** — [Pace Strategy][C50]
- **C51** — [AbsolutSweat sensor integration][C51]
- **C52** — [March 2026 update: Pace Strategy and Hill Alerts][C52]
- **C53** — [Additional fitness metrics reference][C53]
- **C54** — [EvoLab feature reference][C54]
- **C55** — [Daily features][C55]
- **C56** — [Gear Tracking][C56]
- **C57** — [CORE temperature sensor integration][C57]
- **C58** — [Nap detection and timed naps][C58]
- **C59** — [September 2024 update: pool-swim workouts][C59]
- **C60** — [DURA cycling dynamics update][C60]

---

<!-- Markdown reference links -->

[C01]: https://support.coros.com/hc/en-us/articles/360061452651-COROS-Fitness-Metrics-Explained
[C02]: https://coros.com/traininghub
[C03]: https://support.coros.com/hc/en-us/articles/4412383468180-COROS-Training-Hub-Athlete-Tutorial
[C04]: https://support.coros.com/hc/en-us/articles/4412176269844-COROS-Training-Hub-Manual
[C05]: https://support.coros.com/hc/en-us/articles/4412269457172-COROS-Training-Hub-Coaches-Tutorial
[C06]: https://support.coros.com/hc/en-us/articles/15406707571732-Understanding-the-Recovery-Widget
[C07]: https://support.coros.com/hc/en-us/articles/6009189372308-Understanding-Running-Efficiency
[C08]: https://support.coros.com/hc/en-us/articles/51716381180948-Understand-Your-COROS-Sleep-Score
[C09]: https://support.coros.com/hc/en-us/articles/360042390872-How-COROS-Watches-Track-Sleep
[C10]: https://support.coros.com/hc/en-us/articles/51716185581972-August-2026-Feature-Update-Overview
[C11]: https://support.coros.com/hc/en-us/articles/20959044334612-Overnight-HRV
[C12]: https://support.coros.com/hc/en-us/articles/22933466501012-Wellness-Check
[C13]: https://support.coros.com/hc/en-us/articles/22933434857108-Daily-Stress
[C14]: https://support.coros.com/hc/en-us/articles/48547231345684-May-2026-Feature-Update-Highlights
[C15]: https://support.coros.com/hc/en-us/articles/36183438217364-Running-Fitness-Test
[C16]: https://support.coros.com/hc/en-us/articles/25464626934164-Understanding-Your-Running-Fitness-Score
[C17]: https://support.coros.com/hc/en-us/articles/35744841342228-Running-VO2-Max
[C18]: https://support.coros.com/hc/en-us/articles/360061448611-How-to-Receive-and-Update-Running-Fitness-Metrics
[C19]: https://support.coros.com/hc/en-us/articles/27054562262164-FTP-Test
[C20]: https://support.coros.com/hc/en-us/articles/22933404044564-Running-Form-Test
[C21]: https://support.coros.com/hc/en-us/articles/360040531051-Advanced-Running-Metrics
[C22]: https://support.coros.com/hc/en-us/articles/42972399094804-Activity-Tracking-and-Activity-Settings
[C23]: https://support.coros.com/hc/en-us/articles/44184012435348-Maximum-Mean-Power-Curve-MMP-Curve
[C24]: https://support.coros.com/hc/en-us/articles/28021624992404-Cycling-Fitness-Metrics
[C25]: https://support.coros.com/hc/en-us/articles/28021436534932-How-to-Receive-and-Update-Cycling-Fitness-Metrics
[C26]: https://support.coros.com/hc/en-us/articles/28021676382484-Cycling-Efficiency
[C27]: https://support.coros.com/hc/en-us/articles/53742847875604-Cycling-VO2Max
[C28]: https://coros.com/stories/coros-metrics/c/training-load
[C29]: https://coros.com/stories/coros-metrics/c/base-fitness
[C30]: https://coros.com/stories/coros-coaches/c/prepare-for-your-next-race-with-training-status
[C31]: https://support.coros.com/hc/en-us/articles/360044426251-How-to-Follow-Structured-Workouts-on-COROS-Watches
[C32]: https://support.coros.com/hc/en-us/articles/50841795180948-Connect-Your-COROS-to-AI
[C33]: https://coros.com/stories/coros-metrics/c/mcp-testing
[C34]: https://support.coros.com/hc/en-us/articles/360040256531-Supported-3rd-Party-Apps
[C35]: https://support.coros.com/hc/en-us/articles/33126928893460-Change-the-Activity-Type-of-a-Saved-Workout
[C36]: https://coros.com/stories/coros-metrics/c/welcome-to-the-training-hub
[C37]: https://support.coros.com/hc/en-us/articles/20959039543828-Personalized-Marathon-Plans
[C38]: https://support.coros.com/hc/en-us/articles/25002333092500-Requesting-a-Bulk-Export-of-COROS-Data
[C39]: https://support.coros.com/hc/en-us/articles/33125636125204-Bulk-Export-Historical-Activity-Data
[C40]: https://support.coros.com/hc/en-us/articles/15284799576980-Activities-Page-Activity-Summary
[C41]: https://support.coros.com/hc/en-us/articles/360043975752-Exporting-Workout-Data-and-Uploading-to-3rd-Party-Apps
[C42]: https://support.coros.com/hc/en-us/articles/38207953113108-Adventure-Journal
[C43]: https://support.coros.com/hc/en-us/articles/50115465441172-View-Activities-In-Progress
[C44]: https://support.coros.com/hc/en-us/articles/360040256971-How-to-Import-Activities-to-Your-COROS-Account
[C45]: https://support.coros.com/hc/en-us/articles/360052332691-Downloading-Training-Plans-from-TrainingPeaks-to-COROS
[C46]: https://support.coros.com/hc/en-us/articles/25514153681940-Extender
[C47]: https://support.coros.com/hc/en-us/articles/49993205300628-Heart-Rate-Recovery
[C48]: https://support.coros.com/hc/en-us/articles/43054305787924-Log-Training-Notes-and-RPE-with-Your-Voice
[C49]: https://support.coros.com/hc/en-us/articles/42397432137236-Menstrual-Cycle-Tracking
[C50]: https://support.coros.com/hc/en-us/articles/47115766323348-Pace-Strategy
[C51]: https://support.coros.com/hc/en-us/articles/45264901464724-Using-AbsolutSweat-with-COROS
[C52]: https://support.coros.com/hc/en-us/articles/47305529232148-March-2026-Feature-Update-Highlights
[C53]: https://support.coros.com/hc/en-us/articles/4412802807444-Fitness-Metrics
[C54]: https://support.coros.com/hc/en-us/articles/38180411247892-EvoLab
[C55]: https://support.coros.com/hc/en-us/articles/42970041319060-Daily-Features
[C56]: https://support.coros.com/hc/en-us/articles/30206047249556-Gear-Tracking
[C57]: https://support.coros.com/hc/en-us/articles/4416368334868-CORE-Body-Temperature-Sensor
[C58]: https://support.coros.com/hc/en-us/articles/30256354395028-Nap-Detection-and-Tracking
[C59]: https://support.coros.com/hc/en-us/articles/30206256179860-September-2024-Feature-Update-Highlights
[C60]: https://support.coros.com/hc/en-us/articles/30238563613460-September-2024-Update
[G02]: https://support.garmin.com/en-US/?faq=6Dk3BHgLzs13iYV90WX4B9
[G03]: https://support.garmin.com/en-US/?faq=kw7iLT9A2t9ukOnHUqwc59
[G04]: https://support.garmin.com/en-US/?faq=99CGXYuO9u7lywZQWn7B46
[G05]: https://support.garmin.com/en-US/?faq=unLSr8lk0z5EUCi0k8Yys8
[G06]: https://www.garmin.com/en-US/blog/fitness/what-is-the-garmin-connect-performance-dashboard/
[G07]: https://www8.garmin.com/manuals/webhelp/GUID-E3AB50C9-691D-4482-8387-7EEB3961CA87/EN-US/GUID-476303CC-9A30-4D97-B3E2-978EAE76647B.html
[G08]: https://support.garmin.com/en-MY/?faq=kWi5DoaMPZ4VCJBA0lFWP7
[G09]: https://support.garmin.com/en-US/?faq=SEkNpdGyhR917js0qQL3Q6
[G10]: https://www.garmin.com/en-ZA/blog/fitness/garmin-training-status-and-how-to-use-it/
[G11]: https://www8.garmin.com/manuals/webhelp/GUID-0221611A-992D-495E-8DED-1DD448F7A066/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html
[G12]: https://www8.garmin.com/manuals/webhelp/GUID-25E3235D-44D2-4384-A591-DD1D71BEBCB1/EN-US/GUID-7275629E-743A-4658-A284-C84F42A66AE5.html
[G13]: https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-901ACCFC-FB0D-414E-B80C-54970AF4E357.html
[G14]: https://www8.garmin.com/manuals/webhelp/GUID-7AD1A592-9044-4D84-9688-7B5209F85BFF/EN-US/GUID-C83A37F8-1ECE-4FDD-A852-03764F1ECCFF.html
[G15]: https://www8.garmin.com/manuals/webhelp/GUID-025D75CF-3445-49E1-8D81-1AA74AB4E00F/EN-US/GUID-6E986507-83A1-4051-9F28-EB79400940A5.html
[G16]: https://www8.garmin.com/manuals/webhelp/GUID-025D75CF-3445-49E1-8D81-1AA74AB4E00F/EN-US/GUID-62A09512-518A-424A-8491-FE2B80CD2091.html
[G17]: https://www8.garmin.com/manuals/webhelp/GUID-025D75CF-3445-49E1-8D81-1AA74AB4E00F/EN-US/GUID-6335963E-C254-4239-9450-A0212850F303.html
[G18]: https://support.garmin.com/en-US/?faq=QKPwHY88Ug0tadEACs9Ul9
[G19]: https://www8.garmin.com/manuals/webhelp/GUID-2CF5620C-E585-4E0A-9CC3-9565533EEE4D/EN-US/GUID-70D41BFB-2BB2-4933-BF95-47FF63140112.html
[G20]: https://support.garmin.com/en-US/?faq=mBRMf4ks7XAQ03qtsbI8J6
[G21]: https://support.garmin.com/en-US/?faq=PB1duL5p6V64IQwhNvcRK9
[G22]: https://support.garmin.com/en-US/?faq=WT9BmhjacO4ZpxbCc0EKn9
[G23]: https://support.garmin.com/en-US/?faq=VOFJAsiXut9K19k1qEn5W5
[G24]: https://www8.garmin.com/manuals/webhelp/GUID-C001C335-A8EC-4A41-AB0E-BAC434259F92/EN-AU/GUID-9282196F-D969-404D-B678-F48A13D8D0CB.html
[G25]: https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-0EDC68E3-D886-48D2-B624-AA634739B421.html
[G26]: https://support.garmin.com/en-US/?faq=bslU8erVhw62Xil6ptnEE6
[G27]: https://support.garmin.com/en-US/?faq=inhCVaetBJ2tPhxNI8awl6
[G28]: https://www8.garmin.com/manuals/webhelp/GUID-C001C335-A8EC-4A41-AB0E-BAC434259F92/EN-US/GUID-B215CD18-C1E0-4A47-A6C4-7D864CF800CE.html
[G29]: https://www8.garmin.com/manuals-apac/webhelp/fenixe/EN-SG/GUID-7A9F1E4B-7413-42AD-83DB-C8760D6FCCE3-8848.html
[G30]: https://support.garmin.com/en-SG/?faq=ZggTn4wX1K2Y72YT717qQ7
[G31]: https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-31B2458A-859A-4A34-AB83-224E4A29387A.html
[G32]: https://support.garmin.com/en-US/?faq=W1TvTPW8JZ6LfJSfK512Q8
[G33]: https://support.garmin.com/en-US/?faq=aNGg6LTaoT4X7fyCnIuQW6
[G34]: https://support.garmin.com/es-ES/?faq=iK5cTU5TXn8LFtzx05CUx7
[G35]: https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-70D41BFB-2BB2-4933-BF95-47FF63140112.html
[G36]: https://www.garmin.com/en-NZ/blog/how-to-use-garmin-connect-to-track-your-health-and-wellness/
[G37]: https://www8.garmin.com/manuals/webhelp/GUID-D9E9CF32-5A89-4140-8B6A-0A61633E397F/EN-US/GUID-1689E760-EE3F-486D-90F8-1151F7C62201.html
[G38]: https://support.garmin.com/en-US/?faq=oYknGZ910l1pfBNzkDHX6A
[G39]: https://www.garmin.com/en-GB/blog/five-ways-to-use-garmin-coach-on-your-watch/
[G40]: https://www.garmin.com/en-GB/garmin-technology/garmin-coach/garmin-run-coach/
[G41]: https://support.garmin.com/en-US/?faq=pVtmVTZz7C97GZHxtMWgs8
[G42]: https://www.garmin.com/en-US/garmin-coach/triathlon/
[G43]: https://www8.garmin.com/manuals/webhelp/GUID-F41EAFB3-6CC9-42DE-9C6C-9E358DBB0671/EN-US/GUID-FD71D73A-C744-4779-A6C3-2FA9AB89B228.html
[G44]: https://www8.garmin.com/manuals-apac/webhelp/edge850/EN-SG/GUID-011433C1-F5E5-486D-8006-16F4D01E1220-7966.html
[G45]: https://www8.garmin.com/manuals/webhelp/GUID-025D75CF-3445-49E1-8D81-1AA74AB4E00F/EN-US/GUID-3C951E2D-47D7-4626-9285-F5238B7CBFF0.html
[G46]: https://www8.garmin.com/manuals/webhelp/GUID-BD965919-30AA-4EB5-95D7-A899658C50EB/EN-US/GUID-70386BCC-5682-4C5C-9A87-C32AF9B6473B.html
[G47]: https://www.garmin.com/en-US/garmin-technology/health-science/womens-health/
[G48]: https://support.garmin.com/en-US/?faq=YTrs08GL7p4kXmdZ5x5yP9
[G49]: https://www.garmin.com/en-US/garmin-technology/health-science/ecg/
[G50]: https://www.garmin.com/en-US/garmin-technology/health-science/nutrition-tracking/
[G51]: https://www.garmin.com/en-US/newsroom/press-release/sports-fitness/stay-on-top-of-nutrition-goals-in-garmin-connect/
[G52]: https://support.garmin.com/en-US/?faq=hCXLI2NgKa2vAATksWTr59
[G53]: https://www8.garmin.com/manuals-apac/webhelp/fenix8series/EN-SG/GUID-4B85ACA7-C748-490C-9086-8EA4DA0BA5B2-9176.html
[G54]: https://support.garmin.com/en-US/?faq=svpm2I38YB2sU5CiqFXyfA
[G55]: https://support.garmin.com/en-US/?faq=CM1YJmMrrNAbEpM9PapJ07
[G56]: https://www.garmin.com/en-US/garmin-technology/health-science/sleep-coach/
[G57]: https://support.garmin.com/en-US/?faq=i3oQUMQucx46gBclVkvoH8
[G58]: https://support.garmin.com/en-US/?faq=LcYGZd4EOZ9PkTY5YRvin5
[G59]: https://support.garmin.com/en-US/?faq=ndK2tnQOSv8fW8ROI8G2B9
[G60]: https://support.garmin.com/en-US/?faq=8ImmxVkZMh4EYYq5Zp2bR8
[G61]: https://www.garmin.com/en-US/blog/health/top-10-features-to-monitor-your-health/
[G62]: https://support.garmin.com/en-US/?faq=VxKazDQ2mkAmDoQbJriEBA
[G63]: https://www8.garmin.com/manuals/webhelp/GUID-676967A0-1B23-4384-9BC9-76F3D643F1C8/EN-US/GUID-5C0E79E4-C381-4B87-A6A0-B8FE049AB597.html
