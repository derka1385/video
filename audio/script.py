"""The screenplay as data.

Every spoken line, laugh and inner thought lives here. `mix.py` lays these out
on the timeline, and the resulting cue sheet drives the picture.

Timing fields:
  gap    seconds of air after the previous element ends (negative = overlap)
  after  id of the element to follow (defaults to the previous one)
"""

# Speaker -> (Kokoro voice, stereo position -1..1, distance 0..1 from Sam)
CAST = {
    "SAM":  ("bf_emma",  -0.05, 0.00),
    "LU":   ("pf_dora",   0.32, 0.30),
    "RAFA": ("pm_alex",   0.22, 0.55),
    "BIA":  ("af_bella", -0.28, 0.50),
    "NOOR": (None,        0.02, 0.95),
}

EN, PT = "en-us", "pt-br"
SAM_EN = "en-gb"

# (id, speaker, lang, text, speed, gap, extra)
# extra: dict with optional keys: 'hit' (word to punch through), 'laugh'
# (laugh event appended after the line), 'look' (speaker looks at Sam),
# 'after' (anchor id)
LINES = [
    # ---------------------------------------------------------------- warmth
    ("L01", "LU",   EN, "No, wait, wait. It gets worse. So he walks in, sits down, and asks for the menu.", 1.02, 0.0, {}),
    ("L02", "RAFA", EN, "Don't.", 1.0, -0.55, {}),
    ("L03", "LU",   EN, "And the woman just looks at him, and goes: Sir. This is a flower shop.", 1.0, 0.05,
        {"laugh": ("group", 2.6, 0.9),
         "ph": "ænd ðə wˈʊmən dʒˈʌst lˈʊks æt hˌɪm, ænd ɡˈoʊz: sˈɜɹ. ðˈɪs ɪz ɐ flˈaʊɚ ʃˈɑːp."}),
    ("L04", "RAFA", EN, "It looked like a restaurant!", 1.05, -1.3, {}),
    ("L05", "SAM",  SAM_EN, "In his defence, it really does look like a restaurant.", 1.0, 0.25, {}),
    ("L06", "RAFA", EN, "Thank you! Sam gets me.", 1.0, 0.15,
        {"look": True, "ph": "θˈæŋk juː! sˈæːm ɡˈɛts mˌiː."}),
    ("L07", "BIA",  EN, "Okay, but then you bought the tulips.", 1.0, 0.3,
        {"laugh": ("big", 3.4, 1.0)}),
    ("L08", "RAFA", EN, "I panicked! What was I supposed to do?", 1.05, -2.0,
        {"laugh": ("tail", 2.0, 0.6)}),

    # ---------------------------------------------------------------- the switch
    ("P01", "LU",   PT, "Não, mas sério. Você viu a cara dela?", 1.0, -1.1, {}),
    ("P02", "RAFA", PT, "Vi, pô. Eu queria sumir.", 1.0, 0.2, {}),
    ("P03", "BIA",  PT, "E as tulipas? Você deu pra quem, no fim?", 1.0, 0.35, {"hit": "tulipas"}),
    ("P04", "RAFA", PT, "Dei pra minha mãe. Ela amou.", 1.0, 0.3,
        {"laugh": ("pt", 2.4, 0.85), "sam_laugh": True}),
    ("P05", "LU",   PT, "Falando nisso, vocês vão no aniversário da Carol, sábado?", 1.0, 0.1, {"hit": "Carol"}),
    ("P06", "BIA",  PT, "Vou, mas vou chegar tarde. Tô de plantão até as nove.", 1.0, 0.3, {}),
    ("P07", "RAFA", PT, "A casa dela é longe pra caramba, né?", 1.0, 0.25, {}),
    ("P08", "LU",   PT, "A gente vai junto. Eu passo aí e pego vocês.", 1.0, 0.2, {}),
    ("P09", "LU",   PT, "Ah, a gente devia levar a Sam também. Ela ia adorar.", 0.98, 0.9,
        {"hit": "Sam", "look": True,
         "ph": "ˈa, a ʒˈeɪŋtʃy dˌevˈiæ levˈaɾ a sˈɛm tɐ̃mbˈeɪŋ. ˌɛlæ ˈiæ ˌadoɾˈar.",
         "hit_ph": "sˈɛm."}),
    ("P10", "RAFA", PT, "Ia mesmo. Mas lá é tudo em português, coitada.", 1.0, 0.25,
        {"look": True, "laugh": ("sharp", 2.6, 0.95)}),
    ("P11", "BIA",  PT, "Ah, ela se vira. A gente traduz.", 1.0, -1.2,
        {"laugh": ("pt", 2.2, 0.7)}),

    # ---------------------------------------------------------------- inward
    ("P12", "LU",   PT, "A Carol vai fazer aquela feijoada de novo?", 0.97, 2.4, {}),
    ("P13", "RAFA", PT, "Tomara. Foi a melhor coisa que eu comi na vida.", 0.97, 0.6, {}),
    ("P14", "BIA",  PT, "Você fala isso de toda comida.", 0.97, 0.4,
        {"laugh": ("pt", 2.4, 0.8)}),
    ("P15", "LU",   PT, "E o presente? Vamos fazer uma vaquinha?", 0.96, 1.6, {}),
    ("P16", "RAFA", PT, "Pode ser. Alguma coisa pra casa nova dela.", 0.96, 0.7, {}),
    ("P17", "BIA",  PT, "Uma planta! Ela adora planta.", 0.96, 0.6, {}),
    ("P18", "RAFA", PT, "Tulipa não, por favor.", 0.96, 0.5,
        {"laugh": ("sharp", 3.2, 1.0)}),
    ("P19", "LU",   PT, "Gente, que horas são? Amanhã eu acordo cedo.", 0.95, 2.6, {}),
    ("P20", "BIA",  PT, "Você sempre fala isso e fica até as duas.", 0.95, 0.8,
        {"laugh": ("pt", 2.6, 0.8)}),

    # ---------------------------------------------------------------- return
    ("R01", "LU",   EN, "Oh. Sorry.", 0.92, 13.5, {}),
    ("R02", "LU",   EN, "We switched languages.", 0.95, 1.5, {}),
    ("R03", "RAFA", EN, "Sorry, we didn't even realise.", 0.97, 1.1, {}),
    ("R04", "BIA",  EN, "Sam, you're coming on Saturday, right?", 1.0, 1.3, {"look": True}),
    ("R05", "SAM",  SAM_EN, "Yeah.", 0.9, 0.9, {"ph": "jˈɛə."}),
    ("R06", "LU",   EN, "Yes! Okay. But nobody is bringing tulips.", 1.02, 0.45, {}),
    ("R07", "RAFA", EN, "It was one time!", 1.05, 0.15,
        {"laugh": ("warm", 3.0, 0.8)}),
    # the table carries on; the camera stays with Sam
    ("R08", "LU",   EN, "Honestly, though? It was a really nice flower shop.", 1.0, -1.4, {"soft": True}),
    ("R09", "BIA",  EN, "It was! The lady was so sweet about it.", 1.0, 0.25, {"soft": True}),
]

# Inner thoughts: (text, anchor-id, offset-from-anchor-start, duration, style)
# style picks how the picture integrates the words (see film/film.js).
THOUGHTS = [
    ("I know that word.",          "P03", 1.25, 3.0, "reflect"),
    ("I think I understood that.", "P04", 1.7, 3.2, "glass"),
    ("Wait.",                      "P07", 0.4, 2.2, "dark"),
    ("Maybe…",                     "P08", 1.2, 2.6, "dark"),
    ("Were they talking about me?", "P11", 1.4, 4.2, "near"),
    ("Should I say something?",    "P14", 1.2, 3.6, "orb"),
    ("They probably didn't notice.", "P17", 0.2, 3.8, "floor"),
    ("I'm still here.",            "R01", -6.2, 4.6, "last"),
]

# Portuguese, for anyone reading the source (never shown on screen).
TRANSLATION = {
    "P01": "No, but seriously. Did you see her face?",
    "P02": "I did, man. I wanted to disappear.",
    "P03": "And the tulips? Who did you give them to, in the end?",
    "P04": "I gave them to my mom. She loved them.",
    "P05": "Speaking of which, are you all going to Carol's birthday on Saturday?",
    "P06": "Yes, but I'll be late. I'm on shift until nine.",
    "P07": "Her place is really far, isn't it?",
    "P08": "We'll go together. I'll come by and pick you up.",
    "P09": "Oh, we should bring Sam too. She'd love it.",
    "P10": "She really would. But it's all in Portuguese there, poor thing.",
    "P11": "Oh, she'll manage. We'll translate.",
    "P12": "Is Carol making that feijoada again?",
    "P13": "I hope so. Best thing I've ever eaten.",
    "P14": "You say that about every meal.",
    "P15": "And the present? Shall we all chip in?",
    "P16": "Sure. Something for her new place.",
    "P17": "A plant! She loves plants.",
    "P18": "No tulips, please.",
    "P19": "Guys, what time is it? I have to get up early tomorrow.",
    "P20": "You always say that and stay until two.",
}
