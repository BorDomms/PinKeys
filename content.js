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
      title: "Practice Typing",
      html: `<p> 
      Practice your typing skills here. You can choose between different modes to suit your needs. <br><br>

      Note that this is <b><u>strictly English only</u></b> and that this is a <b><u>Physical Keyboard</u></b> test, so please refrain from using any other language or using virtual or touchscreen keyboards as some functions may not work properly. I am still working on extra functions like that : )<br><br>

      Special Controls: <br>
      <ul>
        <li> <b>Tab + Enter</b> <br>
        ---> Quick Restart during a test</li>
        <li> <b>CTRL + Backspace</b> <br>
        ---> Delete entire word/section</li>
      </ul>
      </p>`,
    },
    test: {
      title: "Test Your Typing",
      html: `<p>
      Thisis where you will take the typing test. You will be asked to type some passages, and the system will record your typing patterns to identify you in the future. All special controls are applicable here too. <br><br>
      
      "Speed without accuracy is just noise."
      </p>`,
    },
    identity: {
      title: "Who are you?",
      html: `<p>
      This is where the system will try to identify who you are based on your typing patterns. You will be asked to type 3 short passages, and the system will guess who you are from how you type. <br><br>
      </p>`,
    },
  },

  /* ---------- 2. THE TEST PAGE START SCREEN ---------- */
  test: {
    title: "Enrollment test",

    instructionsTitle: "REGULATIONS",
    instructionsHtml: `<p>
    Welcome to the Test Tab! Here, you will be asked to type some passages. The system will record your typing patterns and use them to identify you in the future. Not to worry, your data is secure and will only be used for identification purposes. You can even download your own data at the end of the test if you so wish to understand your own keystrokes! <br><br>
    >>> Most importantly, this is a <b>PHYSICAL KEYBOARD</b> test. Using a touchscreen or virtual keyboard will not yield accurate results. <br>
     >>> Again, this is a <b>STRICTLY ENGLISH ONLY</b> test. Please refrain from using any other language as some functions may not work properly, especially in Free-Typing tests.
    </p>`,

    warningTitle: "PLEASE READ",
    warningHtml: `<p>
    => This portion can take up to 10 minutes. Please do not leave the page or close the browser while taking the test, as it may result in loss of data. <br>
    => Please ensure that you are in a quiet environment and free from distractions to achieve the best results. <br>
    => As much as possible, do not stop midway through the test. If you need to take a break, please do so before starting the test. <br>
    => Press the restart button to pause the timer if ever you need to stop in the middle of the test. Doing so however makes you restart the current text from the beginning! 
    </p>`,

    regulationsTitle: "<br> Too Long; Didn't Read (TL;DR)",
    regulationsHtml: `<p>
    >>> PHYSICAL KEYBOARD and ENGLISH ONLY. No touchscreen or virtual keyboards. No other languages. <br>
    >>> Take the test in one sitting, in a quiet environment, and without distractions. <br>
    >>> Information is saved online, but the data is private and secure. You can download your own data at the end of the test. <br>
    </p>`,

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
