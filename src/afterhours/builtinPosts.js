// Existing After Hours member posts; not database records.
export const BUILTIN_POSTS = {
  "penny": [
    {
      "id": "nurse",
      "title": "Paging Nurse Morningstar ♏",
      "body": "Tonight's look? Nurse Morningstar. The heels are polished, the clipboard is ready, and my bedside manner comes with a wicked smile. ♠\n\nA little white coat, a little purple ink, and a look that says I already know what you're thinking. All dress-up, darling. 💋"
    },
    {
      "id": "velvet",
      "title": "Velvet After Dark ♠",
      "body": "Close the door, turn the lights down, and tell me you can handle a little temptation. 💋\n\nPink satin, wicked company, and just enough mystery to keep you coming back.\n\nPress play, darling. I make no promises about your concentration. 🔥"
    },
    {
      "id": "cover",
      "title": "A little more Penny after dark ♏",
      "body": "The velvet curtain is open, the lights are pink, and the Queen of Spades is waiting. Come on in, beautiful. 💋"
    },
    {
      "id": "throne",
      "title": "A seat at the table",
      "body": "A little velvet, a little candlelight, and an invitation to stay longer than you planned. There is always room for one more at my table. 💋"
    },
    {
      "id": "vault",
      "title": "The Velvet Vault",
      "body": "Every queen needs her circle. A little beauty, a little attitude, and friends who know how to make an entrance. ♠"
    },
    {
      "id": "letter",
      "title": "A note from Penny",
      "body": "Come for the glamour. Stay for the wicked conversation, late-night company, and whatever happens when the lights turn pink. 🖤"
    }
  ],
  "kandy": [
    {
      "id": "spotlight",
      "title": "Meet Kandy",
      "body": "Meet Kandy through her WildCard creator showcase, music, original art and creative projects."
    }
  ],
  "ashley": [
    {
      "id": "spotlight",
      "title": "Meet Ashley",
      "body": "Visit Ashley’s Time Capsule and memorial collection. Her story remains an important part of WildCard DEV."
    }
  ]
}
export const builtinPostIds = area => (BUILTIN_POSTS[area] || []).map(p=>p.id)
