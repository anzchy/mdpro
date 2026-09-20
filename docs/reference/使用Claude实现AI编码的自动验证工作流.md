使用Claude实现AI编码的自动验证工作流

说话人1 00:00:00
Most AI coding sessions follow a loop. You ask for a change, the agent gets this context, takes action and response. You check the result, ask for another change, and so on.

说话人1 00:00:12
 It's like a turn-based game where every turn waits on you. Sometimes you have to go back and forth a few times until you get what you want it. Because like humans, agents produce better work when they receive feedback. 

说话人1 00:00:26
But the feedback doesn't always have to come from you. As models get better at coding and reasoning, they're also getting better at verifying their own work by observing the signals around them, like type checkers, tests, and runtime errors. Often having these in your code base is enough for Claude to understand what commands to run and how to fix the code.

说话人1 00:00:48
 However, those checks are deterministic. They add a pass or fail, the code works or it doesn't. What port can't always info are the steps you take to manually verify a new feature or. 

说话人1 00:01:00
Those steps aren't usually in the cold race, so the more of those verification steps you can encode for Claude, the closer the first response will learn to what you had in mind. You will spend less time babysitting fewer tokens on back and forth and free yourself up to work on something else while Claude iterates. Let's look at how you can view those verification loops in which claude code features to reach for depending on what you're building. 

说话人1 00:01:27
A good place to start is to write down a best practices version of what you already do. If you're working on webby, that's probably run the dev server, open the browser, click around as if you were the user, check the console for any errors. For backend, you might hit an endpoint and check the status in the response. 

说话人1 00:01:49
EVERY DOMAIN HAS ITS OWN VERSION OF THIS, BUT THE SHAPE IS SIMILAR. NOW FOR EACH OF THOSE, THERE'S SOMETHING CALLED CAN PROBABLY ALREADY DRIVE IN YOUR PLACE. FOR. 

说话人1 00:02:00
Front end that could be the cloud claw Chrome extension，the desktop preview，and the Chrome Dev Tools and CP. Claw can open pages，navigate，take screenshots，read the console，and call web vitals. For backend，it can curl the endpoint and read the response. 

说话人1 00:02:18
For mobile and desktop apps, this computer use and the IOS and Android simulator MCPS. Whatever your manual check looks like, there's usually a way to turn it off to Claude. Once you have clarified your current workflow, you can encode it as a skill by invoking the skill creator and ask Claude to interview you. 

说话人1 00:02:39
If you are struggling to articulate it, you can always ask for to help with domain best practices and to show you what an end-to-end verification film might look like. Looking at the draft that Claude has created, we can see it has decided to verify the changes in browser automation. Capture visual evidence, watch the console. 

说话人1 00:03:02
and check features for regressions. Let's test this kill out. Here's a page that I have been working on. I know there's some layout shift on it, and I haven't got around to fix it. I'm going to ask Claude to work on something completely unrelated. Add a like button.

说话人1 00:03:18
 Claude adds the button, checks it, and because it's a UI change, runs the verification pass on its own. THE DE server starts, THE preview opensENS quote CL THE LIKE BUT button to confirm IT worksKS, and IT takes the screenshotSH. BUT THE skill is also TELL it to CAP capture a PER performance R THR the chrome DE TOOLS MC.

说话人1 00:03:39
 SO CLude REPTS BACK. THE LIKE BUT button WORKS, BUT THERE's layoutAY shift on THIS pageGE. It wasn't part of the task, but the skill quoted because checking call web vitals is part of the workflow we created.

说话人1 00:03:52
 This is a small example, but you can imagine as you encode more of your workflow, chords coverage grows. Finally, before. Your ship your ideas to the world, it's worth getting a second pair of eyes on it or another agent.

说话人1 00:04:06
 A second agent won't have the same biases as the agent who wrote the code. It has its own context and it's not going to be influenced by previous conversations. This isolation can make the reviews more honest and catch things that the first agent might have missed. 

说话人1 00:04:22
Here are a few options that you have for code reviews: the code review plugin spins up several subagents in parallel, each looking on the change from a different angle, scoring the findings for confidence, and posting the result back on the PR. And the managed Claude code review feature runs automatically on every PR to GitHub for team and enterprise plans. Whichever you pick, it's helpful to have a last line of defense before merging.

说话人1 00:04:48
 So at this point, you have two layers: there is the verification layer that runs while code is building your application, and then there's a second review before you merge from an agent that didn't write. The quote，both of those are part of the same overarching development cycle。Think about how things heal right now，you make a change，you clean it up，you verify it works，you commit，open up PR，you get it reviewed，and you keep an eye on the CI。You can actually roll these steps into one workflow by writing a skill that calls all these skills.

说话人1 00:05:22
 For example, the Claude Code team has a skill they run whenever they're shipping a feature. It calls the Building Simplify Skill to clean up the diff, Custom Verify Skills to confirm that the change works end-to-end, a Design Check if the diff touched the UI. A step to open and subscribe to a PR and one that watches CI and fixes failures as they come in. 

说话人1 00:05:47
All right, that is all for now. Your workflows might look different. The point is to hand off as much as possible so Claude can verify its own work end to end.