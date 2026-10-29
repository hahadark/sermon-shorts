/*
 * bgm-catalog.js - 배경음악 추천 목록 (음악 파일은 앱에 들어 있지 않고, 아래 주소에서 바로 재생한다).
 * 저작권이 공개된 곡만 넣는다: 퍼블릭 도메인(PD), CC0, CC BY(출처 표시). 상업 이용·편집(자르기·페이드) 허용.
 * 곡마다 원래 페이지에서 라이선스를 확인했다 (verified). 새 곡을 넣을 때도 같은 기준으로.
 * UMD: 렌더러 SS.bgmCatalog, Node require().
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.SS = root.SS || {}; root.SS.bgmCatalog = api; }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null), function () {
  'use strict';
  var MOODS = ['잔잔한 피아노', '묵상·앰비언트', '희망·따뜻함', '찬송가 연주', '클래식'];
  // 2026-10-29 확인: 각 곡 원래 페이지의 라이선스 문구(licenseQuote)와 직접 재생 주소(HTTP 206) 확인
  var tracks = [
    {
      "id": "meditation-impromptu-01",
      "title": "Meditation Impromptu 01",
      "artist": "Kevin MacLeod",
      "mood": "잔잔한 피아노",
      "tags": [
        "피아노",
        "잔잔함",
        "묵상"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2001.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100163",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Meditation Impromptu 01\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Meditation Impromptu 01\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming a",
      "durationSec": 213,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "meditation-impromptu-02",
      "title": "Meditation Impromptu 02",
      "artist": "Kevin MacLeod",
      "mood": "잔잔한 피아노",
      "tags": [
        "피아노",
        "잔잔함",
        "묵상"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2002.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100162",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Meditation Impromptu 02\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Meditation Impromptu 02\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming a",
      "durationSec": 249,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "moonstone",
      "title": "Moonstone",
      "artist": "Kevin MacLeod",
      "mood": "잔잔한 피아노",
      "tags": [
        "피아노",
        "잔잔함"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Moonstone.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100145",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Moonstone\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Moonstone\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with cr",
      "durationSec": 255,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "friday-morning",
      "title": "Friday Morning",
      "artist": "Kevin MacLeod",
      "mood": "잔잔한 피아노",
      "tags": [
        "피아노",
        "잔잔함",
        "아침"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Friday%20Morning.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100224",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Friday Morning\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Friday Morning\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed wi",
      "durationSec": 210,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "starry",
      "title": "Starry",
      "artist": "Kevin MacLeod",
      "mood": "잔잔한 피아노",
      "tags": [
        "피아노",
        "잔잔함",
        "밤"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Starry.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100062",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Starry\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Starry\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with credi",
      "durationSec": 199,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "airship-serenity",
      "title": "Airship Serenity",
      "artist": "Kevin MacLeod",
      "mood": "묵상·앰비언트",
      "tags": [
        "앰비언트",
        "패드",
        "평온"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Airship%20Serenity.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600046",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Airship Serenity\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Airship Serenity\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed ",
      "durationSec": 240,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "immersed",
      "title": "Immersed",
      "artist": "Kevin MacLeod",
      "mood": "묵상·앰비언트",
      "tags": [
        "앰비언트",
        "피아노",
        "현악",
        "묵상"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Immersed.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600010",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Immersed\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Immersed\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with cre",
      "durationSec": 249,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "deliberate-thought",
      "title": "Deliberate Thought",
      "artist": "Kevin MacLeod",
      "mood": "묵상·앰비언트",
      "tags": [
        "앰비언트",
        "합창패드",
        "묵상"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Deliberate%20Thought.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100261",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Deliberate Thought\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Deliberate Thought\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowe",
      "durationSec": 177,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "frozen-star",
      "title": "Frozen Star",
      "artist": "Kevin MacLeod",
      "mood": "묵상·앰비언트",
      "tags": [
        "앰비언트",
        "하프",
        "합창",
        "신비"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Frozen%20Star.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100356",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Frozen Star\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Frozen Star\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with ",
      "durationSec": 221,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "eternal-hope",
      "title": "Eternal Hope",
      "artist": "Kevin MacLeod",
      "mood": "희망·따뜻함",
      "tags": [
        "희망",
        "피아노",
        "현악",
        "합창"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Eternal%20Hope.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100238",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Eternal Hope\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Eternal Hope\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with",
      "durationSec": 284,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "windswept",
      "title": "Windswept",
      "artist": "Kevin MacLeod",
      "mood": "희망·따뜻함",
      "tags": [
        "따뜻함",
        "기타",
        "현악",
        "잔잔함"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Windswept.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100757",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Windswept\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Windswept\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with cr",
      "durationSec": 208,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "aretes",
      "title": "Aretes",
      "artist": "Kevin MacLeod",
      "mood": "희망·따뜻함",
      "tags": [
        "희망",
        "피아노",
        "합창",
        "따뜻함"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Aretes.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100325",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Aretes\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Aretes\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with credi",
      "durationSec": 276,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "clear-air",
      "title": "Clear Air",
      "artist": "Kevin MacLeod",
      "mood": "희망·따뜻함",
      "tags": [
        "따뜻함",
        "기타",
        "피아노",
        "맑음"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Clear%20Air.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100626",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Clear Air\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Clear Air\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed with cr",
      "durationSec": 184,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "amazing-grace-2011",
      "title": "Amazing Grace 2011",
      "artist": "Kevin MacLeod",
      "mood": "찬송가 연주",
      "tags": [
        "찬송가",
        "어메이징 그레이스",
        "클라리넷",
        "오르간"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Amazing%20Grace%202011.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100820",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Amazing Grace 2011\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Amazing Grace 2011\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowe",
      "durationSec": 189,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "amazing-grace-usaf-strings",
      "title": "Amazing Grace (strings)",
      "artist": "United States Air Force Band (Strolling Strings)",
      "mood": "찬송가 연주",
      "tags": [
        "찬송가",
        "어메이징 그레이스",
        "현악"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/5/54/Amazing_Grace_%28USAFB_strings%29.ogg",
      "page": "https://commons.wikimedia.org/wiki/File:Amazing_Grace_(USAFB_strings).ogg",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This image or file is a work of a U.S. Air Force Airman or employee, taken or made as part of that person's official duties\" (Public domain)",
      "durationSec": 125,
      "format": "ogg",
      "contentIdRisk": "low"
    },
    {
      "id": "amazing-grace-usaf-brass",
      "title": "Amazing Grace (brass)",
      "artist": "United States Air Force Band (Ceremonial Brass)",
      "mood": "찬송가 연주",
      "tags": [
        "찬송가",
        "어메이징 그레이스",
        "금관"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/7/78/Amazing_Grace_%28USAFB_brass%29.ogg",
      "page": "https://commons.wikimedia.org/wiki/File:Amazing_Grace_(USAFB_brass).ogg",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This image or file is a work of a U.S. Air Force Airman or employee, taken or made as part of that person's official duties\" (Public domain)",
      "durationSec": 169,
      "format": "ogg",
      "contentIdRisk": "low"
    },
    {
      "id": "nearer-my-god-usaf-brass",
      "title": "Nearer, My God, to Thee (Ceremonial Brass)",
      "artist": "United States Air Force Band",
      "mood": "찬송가 연주",
      "tags": [
        "찬송가",
        "주께 더 가까이",
        "금관"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/b/bf/Nearer_My_God_to_Thee_-_Ceremonial_Brass_-_United_States_Air_Force_Band.mp3",
      "page": "https://commons.wikimedia.org/wiki/File:Nearer_My_God_to_Thee_-_Ceremonial_Brass_-_United_States_Air_Force_Band.mp3",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This file is provided on the basis of the United States Air Force's representation that it is in the public domain.\" (source music.af.mil Public-Domain-Music)",
      "durationSec": 153,
      "format": "mp3",
      "contentIdRisk": "low"
    },
    {
      "id": "nearer-my-god-usaf-concert",
      "title": "Nearer, My God, to Thee (Concert Band)",
      "artist": "United States Air Force Band",
      "mood": "찬송가 연주",
      "tags": [
        "찬송가",
        "주께 더 가까이",
        "관악"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/e/e6/Nearer_My_God_to_Thee_-_Concert_Band_-_United_States_Air_Force_Band.mp3",
      "page": "https://commons.wikimedia.org/wiki/File:Nearer_My_God_to_Thee_-_Concert_Band_-_United_States_Air_Force_Band.mp3",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This file is provided on the basis of the United States Air Force's representation that it is in the public domain.\" (source music.af.mil Public-Domain-Music)",
      "durationSec": 144,
      "format": "mp3",
      "contentIdRisk": "low"
    },
    {
      "id": "eternal-father-marine-band",
      "title": "Eternal Father, Strong to Save",
      "artist": "U.S. Marine Band",
      "mood": "찬송가 연주",
      "tags": [
        "찬송가",
        "관악",
        "엄숙"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/6/66/Eternal_Father%2C_Strong_to_Save_-_U.S._Marine_Band.ogg",
      "page": "https://commons.wikimedia.org/wiki/File:Eternal_Father,_Strong_to_Save_-_U.S._Marine_Band.ogg",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This file is a work of a United States Marine or employee, taken or made as part of that person's official duties. As a work of the U.S. federal government, it is in the public domain.\"",
      "durationSec": 66,
      "format": "ogg",
      "contentIdRisk": "low"
    },
    {
      "id": "gymnopedie-1",
      "title": "Gymnopedie No. 1",
      "artist": "Kevin MacLeod",
      "mood": "클래식",
      "tags": [
        "사티",
        "피아노",
        "짐노페디"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Gymnopedie%20No%201.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100787",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Gymnopedie No. 1\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Gymnopedie No. 1\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming allowed ",
      "durationSec": 187,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "prelude-in-c-bwv846",
      "title": "Prelude in C (BWV 846)",
      "artist": "Kevin MacLeod",
      "mood": "클래식",
      "tags": [
        "바흐",
        "피아노",
        "전주곡"
      ],
      "url": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Prelude%20in%20C%20-%20BWV%20846.mp3",
      "page": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100689",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "\"Prelude in C (BWV 846)\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/",
      "licenseQuote": "Attribution Code: \"Prelude in C (BWV 846)\" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/ (incompetech track page, checked on Eternal Hope; same generated template; FAQ confirms commercial use incl. streaming al",
      "durationSec": 179,
      "format": "mp3",
      "contentIdRisk": "unknown"
    },
    {
      "id": "bach-air-usaf-strings",
      "title": "Air on the G String (Bach, BWV 1068)",
      "artist": "Air Force Strings, United States Air Force Band",
      "mood": "클래식",
      "tags": [
        "바흐",
        "현악",
        "G선상의 아리아"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/e/ec/Air_-_Air_Force_Strings_-_United_States_Air_Force_Band.mp3",
      "page": "https://commons.wikimedia.org/wiki/File:Air_-_Air_Force_Strings_-_United_States_Air_Force_Band.mp3",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This file is provided on the basis of the United States Air Force's representation that it is in the public domain.\" (source music.af.mil Public-Domain-Music)",
      "durationSec": 183,
      "format": "mp3",
      "contentIdRisk": "low"
    },
    {
      "id": "pachelbel-canon-usaf-strings",
      "title": "Canon (Pachelbel)",
      "artist": "Strolling Strings, United States Air Force Band",
      "mood": "클래식",
      "tags": [
        "파헬벨",
        "현악",
        "캐논"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/1/12/Canon_%282004%29_-_Strolling_Strings_-_United_States_Air_Force_Band.mp3",
      "page": "https://commons.wikimedia.org/wiki/File:Canon_(2004)_-_Strolling_Strings_-_United_States_Air_Force_Band.mp3",
      "license": "Public Domain",
      "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
      "attribution": "",
      "licenseQuote": "\"This file is provided on the basis of the United States Air Force's representation that it is in the public domain.\" (source music.af.mil Public-Domain-Music)",
      "durationSec": 229,
      "format": "mp3",
      "contentIdRisk": "low"
    },
    {
      "id": "clair-de-lune-goedhart",
      "title": "Clair de lune (Debussy)",
      "artist": "Laurens Goedhart",
      "mood": "클래식",
      "tags": [
        "드뷔시",
        "피아노",
        "월광"
      ],
      "url": "https://upload.wikimedia.org/wikipedia/commons/b/be/Clair_de_lune_%28Claude_Debussy%29_Suite_bergamasque.ogg",
      "page": "https://commons.wikimedia.org/wiki/File:Clair_de_lune_(Claude_Debussy)_Suite_bergamasque.ogg",
      "license": "CC BY 3.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
      "attribution": "\"Clair de lune\" (Debussy), performed by Laurens Goedhart, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), via Wikimedia Commons",
      "licenseQuote": "Recording: \"This file is licensed under the Creative Commons Attribution 3.0 Unported license.\" (composition PD, Debussy d.1918)",
      "durationSec": 304,
      "format": "ogg",
      "contentIdRisk": "unknown"
    }
  ];
  return { MOODS: MOODS, tracks: tracks };
}));
