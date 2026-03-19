# Meeting Analysis: Meet Buddy Dogfooding Session

**Date:** 2026-03-19
**Started:** 22:50 IST (17:20 UTC)
**Ended:** ~23:20 IST (17:50 UTC)
**Duration:** ~30 minutes
**Participants:** Axit (You / aumiqx founder), Earth Clique
**Context:** Live dogfooding session -- using Meet Buddy to test and improve Meet Buddy itself
**Status:** FINAL ANALYSIS

---

## 1. Meeting Summary

Axit and Earth Clique conducted a live dogfooding session where they used Meet Buddy v2 to analyze and improve Meet Buddy itself. The session had two distinct phases:

**Phase 1 (22:50 - 22:55):** Axit outlined the plan in Hinglish. The core idea: fix the existing issues first, then create a feedback form for improving the agent tool. He proposed running all agents in the background to analyze, discuss, and fix the tool during the meeting itself -- a true "tool improves itself" meta-approach. Earth Clique agreed and Axit began issuing commands to make the tool self-improve during the live session.

**Phase 2 (22:55 - 23:20):** Axit switched to English to declare the next phase: making Meet Buddy live during the same call. He announced they would fix and improve the app in real-time. He revealed that multiple parallel workstreams were running simultaneously:
- The meeting was being recorded and saved to memory
- A separate scraper/version stabilization agent ("Deepak") was reading all source code and writing the full build story
- The session itself would become blog content showing the prompts used and how the tool was built
- Agents were running in background doing actual work

Earth Clique was enthusiastic ("Han mast idea bhai" -- "Great idea, brother") and engaged with humor, joking about the tool "eating its own tail" when told it would fix itself.

## 2. Key Topics

1. **Bug fixes first** -- Identified issues need to be resolved before expanding functionality
2. **Feedback form for agents** -- Creating a structured way to collect improvement suggestions for the agent tool
3. **Self-improving tool (dogfooding)** -- Using Meet Buddy's own agents to analyze and fix Meet Buddy during a live meeting
4. **Making it live in-call** -- Shipping improvements during the same Google Meet session
5. **Blog content from session** -- Recording prompts, agent behavior, and build process for a product blog post
6. **Parallel agent workstreams** -- Multiple agents running simultaneously: transcript capture, analysis, source code reading, story writing
7. **Scraper version stabilization** -- A separate "Deepak" agent reading all source code and writing the full build story

## 3. Action Items

| # | Item | Owner | Priority | Notes |
|---|------|-------|----------|-------|
| 1 | Fix existing identified issues in Meet Buddy | Axit | High | Must be done before creating feedback form |
| 2 | Create feedback/improvement form for agent tool | Axit | High | Structured way to collect improvement ideas from users |
| 3 | Run agents to self-analyze and fix the tool | Axit | High | Dogfooding -- agents analyze their own codebase |
| 4 | Ship improvements live during the call | Axit | High | Real-time deployment during testing session |
| 5 | Document session for blog post | Axit | Medium | Capture prompts, agent outputs, and build process |
| 6 | Complete scraper/version stabilization | Axit (Deepak agent) | Medium | Agent reading source code and writing full story |
| 7 | Save meeting recording and memory artifacts | Axit | Medium | Already in progress via claude-flow memory |

## 4. Pain Points (Ranked by Severity)

### High Severity
- **Existing bugs need fixing first** -- Axit explicitly states "yah chijen fix kar" (fix these things) before moving to new features, indicating known issues are blocking progress
- **Tool cannot improve itself without explicit orchestration** -- Requires careful command crafting to get agents to analyze and fix their own codebase

### Medium Severity
- **Transcript duplication from live captions** -- The raw transcript shows incremental line-by-line buildup as speech recognition processes words (visible in 22:50:06 through 22:50:14 entries)
- **Multiple parallel workstreams are hard to track** -- Blog documentation, transcript capture, source code analysis, and live fixes all running simultaneously

### Low Severity
- **Hinglish transcription quality** -- Speech recognition captures Hinglish reasonably but with some artifacts (e.g., "bolate Hain" instead of "bolte hain")

## 5. Key Decisions

| Decision | Rationale |
|----------|-----------|
| Fix bugs before new features | Stability first; existing issues block broader adoption |
| Create improvement feedback form | Structured collection of agent tool improvement ideas |
| Dogfooding approach (self-improvement) | Use Meet Buddy agents to analyze and fix Meet Buddy -- proves the tool's value |
| Ship live during the call | Real-time iteration; demonstrates confidence in the tool |
| Document everything for blog | The meta nature of the session (tool testing itself) is compelling content |
| Run "Deepak" scraper agent in parallel | Source code reading and story writing happens alongside the meeting |

## 6. Emotional Signals

| Signal | Who | Context |
|--------|-----|---------|
| Excitement / Confidence | Axit | Enthusiastic about the dogfooding approach; boldly declares "we're gonna make it live in the same call" |
| Agreement / Encouragement | Earth Clique | "Han theek hai" (Yes, that's fine) -- supportive of the plan |
| Strong Enthusiasm | Earth Clique | "Han mast idea bhai. Chalao hamari screen mein" (Great idea brother. Run it on our screen) |
| Playful Humor | Earth Clique | "Apni poochh khud hi khaega kyon?" (Will it eat its own tail? Why?) -- clever joke about self-improving tool |
| Fun / Camaraderie | Earth Clique | "Bus to fir tum majedar hai bhai" (You're fun/entertaining, brother) |

## 7. Questions Asked

| Question | Who | Context | Answered? |
|----------|-----|---------|-----------|
| "Apni poochh khud hi khaega kyon?" (Will it eat its own tail? Why?) | Earth Clique | Rhetorical/humorous question about the tool improving itself | Implied yes -- that's the plan |

## 8. Transcript Translations (Key Segments)

### Segment 1: The Plan (22:50:06 - 22:50:14)
**Original (Hinglish):** "bolate hain ki yah chijen fix kar, uske baad na ham log ek form karte hain. Like agents ka isi tool ko improve karne ke liye. Like time main baat kar raha hun tere saath aur ham isi tool ko improve kar rahe hain. Isi tool ke baare mein discussion ho raha hai to sabhi agents ko dauda, analyse kar har chij. Aur isko agent hamen isko hi theek karna hai."

**Translation:** "Let's say we fix these things first, then after that we'll create a form. For improving this very tool using agents. Like right now I'm talking with you and we're improving this tool. Since the discussion is about this tool itself, run all agents, analyze everything. And we need to fix this tool itself using the agents."

### Segment 2: Self-Improvement Command (22:50:16 - 22:50:27)
**Original:** "Theek hai to main isko aisa command deta hun na taki isi ko khud improve kar rahe ho aur isi meeting ke jariye."

**Translation:** "Okay so I'll give it a command like this so that it improves itself through this very meeting."

### Segment 3: Going Live (22:55:41)
**Original (mixed):** "Ab aisa karta hai... we're gonna make it live in the same call and we're gonna fix and make this app better. This call is now the testing call and the actual like meeting for this tool itself."

**Translation:** Already mostly in English. Axit declares the call is now both the test and the real meeting for the tool.

### Segment 4: Parallel Workstreams (22:55:41)
**Original:** "Bhai ki jo bhi main laut ke saath baat kar raha hun, abhi yah session hai, usko record kar raha hai. Aur memory mein save karta ja raha hai jo ki phir isko ham log post banaenge ki hamare prompt hue aur kaise kaise banaen."

**Translation:** "Brother, whatever I'm discussing with [Claude], this session is being recorded. And it keeps saving to memory, which we'll then use to make a post about our prompts and how we built everything."

### Segment 5: Earth Clique's Enthusiasm (22:55:41)
**Original:** "Han mast idea bhai. Chalao hamari screen mein aur saath-saath changes bhi dekh rahe hain."

**Translation:** "Great idea, brother. Run it on our screen and we'll watch the changes happening alongside."

### Segment 6: The Tail Joke (22:55:41)
**Original:** "Apni poochh khud hi khaega kyon?"

**Translation:** "Will it eat its own tail? Why?" (Ouroboros reference -- the tool improving itself)

## 9. Timeline

| Time (IST) | Event |
|------------|-------|
| 22:50 | Meeting starts; Axit outlines the plan in Hinglish -- fix bugs first, then create feedback form |
| 22:50 | Axit proposes dogfooding: agents analyze and fix the tool during the live meeting |
| 22:50 | Earth Clique agrees: "han theek hai" |
| 22:50 | Axit begins issuing commands to make the tool self-improve |
| 22:55 | Phase 2: Axit switches to English, declares they'll make it live during the call |
| 22:55 | Reveals multiple parallel agents running: recorder, scraper (Deepak), blog documenter |
| 22:55 | Earth Clique enthusiastic: "Han mast idea bhai" |
| 22:55 | Earth Clique jokes about self-improvement: "Apni poochh khud hi khaega?" |
| 22:55 | Axit confirms scraper/version stabilization agent is reading all source code |
| 23:20 | Meeting ends (noted in transcript) |

## 10. Product Insights

### What worked well
- **Parallel agent orchestration** -- Multiple agents (transcript, analysis, scraper, memory) running simultaneously during a live meeting
- **Memory pipeline** -- Session data being saved to claude-flow memory in real-time for later use
- **Dogfooding concept** -- Using the tool to improve itself is both a valid testing strategy and compelling content
- **Hinglish transcript capture** -- Despite being a mix of Hindi and English, the transcript is readable and analyzable

### What needs improvement
- **Transcript deduplication** -- Incremental speech recognition produces many duplicate/partial lines (22:50:06-22:50:14 shows the same sentence building up word by word)
- **Timestamp granularity** -- Many events compressed into the same second (22:55:41 has ~8 different entries)
- **Meeting end detection** -- The "[NOTE]: the meeting is ended" marker was in the transcript but the `meeting-ended` memory key was not set, requiring the analyst to detect end-of-meeting from transcript content

### Recommended Improvements
1. **Deduplicate incremental captions** -- Only store the final complete sentence, not each partial recognition result
2. **Set meeting-ended flag explicitly** -- When the note is added to the transcript, also set the `meeting-ended` memory key
3. **Improve timestamp distribution** -- Batch entries at 22:55:41 suggest a sync dump rather than real-time streaming
4. **Add speaker diarization confidence** -- Help distinguish speakers more reliably in Hinglish conversations

---

_Final analysis generated by Meet Buddy AI Analyst Agent_
_Monitoring period: ~2 minutes (2 poll cycles at 60-second intervals)_
_Total transcript duration analyzed: ~30 minutes (22:50 - 23:20 IST)_
_Unique timestamped entries: ~30_
_Language: Hinglish (Hindi + English), with full translations provided_
