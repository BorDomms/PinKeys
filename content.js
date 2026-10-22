/* ==============================================================
   PINKEYS — content.js
   ★ THIS IS THE FILE YOU EDIT TO WRITE YOUR OWN TEXT. ★
   Nothing here affects how the site works, only what it says.
   Every "html" field accepts simple HTML: <p>…</p>, <ul><li>…</li></ul>, <b>…</b>, <a href="…">…</a>.
   Keep the quote marks and commas exactly as they are. Use `backticks` (the key under Esc) for long text so
   it can run over several lines.
   Sections:
     1. howTo     the small "?" widget at the top right of each page   (one box per page)
     2. test      the Test page start screen: instructions, warning, regulations, the two checkboxes
     3. identity  the messages on the Identity page
   ============================================================== */
window.PINKEYS_CONTENT = {

  /* ---------- 1. THE "?" WIDGET (top right of every page) ---------- */
  howTo: {
    practice: {
      title: "How to use Practice",
      html: `<p>✏️ EDIT ME (content.js → howTo → practice): explain how Practice works.</p>`,
    },
    test: {
      title: "How to use the Test",
      html: `<p>✏️ EDIT ME (content.js → howTo → test): explain how the Test works.</p>`,
    },
    identity: {
      title: "How to use Identity",
      html: `<p>✏️ EDIT ME (content.js → howTo → identity): explain how Identity works.</p>`,
    },
  },

  /* ---------- 2. THE TEST PAGE START SCREEN ---------- */
  test: {
    title: "Enrollment test",

    instructionsTitle: "Instructions",
    instructionsHtml: `<p>✏️ EDIT ME (content.js → test → instructionsHtml): what the person has to do.</p>`,

    warningTitle: "Please read",
    warningHtml: `<p>✏️ EDIT ME (content.js → test → warningHtml): warnings, for example how long it takes.</p>`,

    regulationsTitle: "Regulations",
    regulationsHtml: `<p>✏️ EDIT ME (content.js → test → regulationsHtml): rules for taking the test.</p>`,

    // the checkbox everybody must tick
    consentText: `I understand that when I finish, a copy of my results is saved online so the Identity page can recognize me. It includes my name and every key I press and when, so anything I write in the written answers can be read from it. I won't type anything private.`,

    // shown ONLY to people who already have saved data
    replaceText: `I understand that taking this test again REPLACES my old data with the new data I am about to record.`,
  },

  /* ---------- 3. THE IDENTITY PAGE ---------- */
  identity: {
    intro: `Type 3 short passages and the system will guess who you are from how you type.`,
    noData: `Take the Test to participate here.`,
    needsUpdate: `Your test data is saved, but the model doesn't include it yet. Press Update model.`,
    training: `The model is being updated…`,
    ready: `You're in the model. You can start the live test.`,
    // shown while an update is needed or running; {practice} becomes a link to the Practice page
    disclaimerHtml: `Updating the model takes some time (often a minute or more). While you wait, you can enjoy {practice}.`,
    loggedOut: `Log in to use Identity.`,
  },
};
