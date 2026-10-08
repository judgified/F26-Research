# F26-Research

Research on the UI/UX of generative AI tools, and the design and build of **Anielle AI**, a chatbot whose interface is informed by that research.

The project compares how a range of generative AI tools handle interface and interaction design. Its findings then guide the design of Anielle, so each of her design decisions traces back to something observed in the study.

## Research questions

- **RQ1:** How do mainstream and niche generative AI interfaces compare on six defined UI/UX criteria?
- **RQ2:** On which criteria do they converge, and on which do they diverge?

## Nature of the testing

The study evaluates the **interface and interaction design** of each tool: how it communicates, recovers from errors, renders output, exposes controls, and discloses what it is doing. It does **not** evaluate the accuracy or intelligence of the underlying models.

It is a structured heuristic evaluation:

- **Same conditions for every tool.** Each tool is tested on the same plan tier (ideally free), with a fresh account on default settings, on desktop web in one browser at one window size, in English, within a single date window. A narrowed window or mobile view is used only to check responsive behavior.
- **Same tasks, in the same order.** Every tool goes through an identical set of seven tasks:
  - asking a sourced factual question;
  - writing and revising text, including editing, regenerating and stopping responses;
  - uploading files;
  - handling ambiguous, impossible and interrupted requests;
  - changing personalization settings;
  - returning to an earlier conversation;
  - a keyboard-only and screen-reader pass.
- **Evidence for every judgment.** Each observation is backed by dated screenshots or screen recordings.
- **Fair comparison.** Features available only on paid plans are marked as gated rather than counted. Expectations are written down before testing to guard against confirmation bias. A second evaluator independently checks a subset of the results.

Usability is understood through ISO 9241-11, as effectiveness, efficiency and satisfaction in a specified context of use. This is why the testing conditions are kept fixed.

## Tools examined

Tools are grouped by the type of interface they offer:

- **ChatGPT:** a mainstream standalone app.
- **Claude:** a mainstream standalone app.
- **Gemini:** embedded in a larger platform (Google).
- **Grok:** embedded in a larger platform (X).
- **Perplexity:** niche because of how its interface works; it puts search first and centers on citations.
- **DeepSeek:** a niche standalone app.
- **Mistral:** a niche standalone app.
- **Qwen:** mainstream in China, and niche relative to the Western market.

## Evaluation criteria

1. **Error handling:** how the interface communicates and recovers from problems such as failed or interrupted responses, unsupported files, over-long input, usage limits and refusals.
2. **Conversation flow:** how the interaction is designed, including threading, input behavior, editing, regenerating, branching, history, scrolling and follow-up suggestions.
3. **Visual design consistency:** how consistent and readable the interface and its output are across screens, states, content types, themes and window sizes.
4. **Customization:** how much control users have over appearance, behavior and memory, and how easy those settings are to find and use.
5. **Accessibility:** how usable the interface is for people with disabilities, measured against WCAG 2.2 Level AA.
6. **Response transparency:** how clearly the interface shows what the system is doing and where information comes from. This covers process states, sources, which model answered, tool use, uncertainty, and how user data is used.

## Framework grounding

Each criterion is based on established usability and human-AI interaction research:

- **Error handling:** Nielsen's heuristics 5 (error prevention) and 9 (helping users recognize, diagnose and recover from errors), and Amershi et al.'s (2019) guidelines on efficient dismissal, correction and scoping when in doubt.
- **Conversation flow:** Nielsen's heuristics 3 (user control and freedom), 6 (recognition rather than recall) and 7 (flexibility and efficiency of use). It also draws on Nielsen (2023) on intent-based interaction and Subramonyam et al. (2024) on why prompt-based interaction is difficult.
- **Visual design consistency:** Nielsen's heuristics 4 (consistency and standards) and 8 (aesthetic and minimalist design), and satisfaction as defined in ISO 9241-11.
- **Customization:** Amershi et al. (2019) on global controls and granular feedback, Nielsen's heuristic 7, and Weisz et al. (2024).
- **Accessibility:** W3C's WCAG 2.2 at Level AA.
- **Response transparency:** Nielsen's heuristic 1 (visibility of system status), Amershi et al. (2019) on making clear what the system can do and why, Liao and Vaughan (2023), and Google PAIR's People + AI Guidebook.

## Roadmap

- [x] Draft the UI/UX evaluation test plan
- [ ] Finalize the shortlist of tools
- [ ] Run a pilot on one tool and finalize the tasks
- [ ] Evaluate all tools
- [ ] Have a second evaluator check a subset
- [ ] Analyze the results and write the paper
- [ ] Turn the findings into a design spec for Anielle
- [ ] Build Anielle AI
- [ ] Evaluate Anielle using the same process

## References

- Amershi, S., et al. (2019). Guidelines for Human-AI Interaction. *Proceedings of the 2019 CHI Conference on Human Factors in Computing Systems.*
- Google PAIR. *People + AI Guidebook.* https://pair.withgoogle.com/guidebook
- ISO 9241-11:2018. *Ergonomics of human-system interaction, Part 11: Usability: Definitions and concepts.*
- Liao, Q. V., and Vaughan, J. W. (2023). AI Transparency in the Age of LLMs: A Human-Centered Research Roadmap.
- Nielsen, J. (1994). *10 Usability Heuristics for User Interface Design.* Nielsen Norman Group.
- Nielsen, J. (2023). *AI: First New UI Paradigm in 60 Years.* Nielsen Norman Group.
- Subramonyam, H., et al. (2024). Bridging the Gulf of Envisioning: Cognitive Challenges in Prompt Based Interactions with LLMs. *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems.*
- W3C. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2.* https://www.w3.org/TR/WCAG22/
- Weisz, J. D., et al. (2024). Design Principles for Generative AI Applications. *Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems.*
