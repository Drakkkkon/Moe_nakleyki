/* Мое_наклейки — штрихкоды Code 128 и EAN-13.
 * encode(...) возвращает { modules: [1,0,1,...], text, quietLeft, quietRight }
 * 1 — чёрный модуль (полоса), 0 — белый. */
(function (g) {
  "use strict";

  // Code 128: ширины «полоса/пробел» для значений 0..106 (106 — стоп, 7 элементов)
  const C128 = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
  ];
  const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

  function widthsToModules(widths, out) {
    let bar = true;
    for (const ch of widths) {
      const n = ch.charCodeAt(0) - 48;
      for (let i = 0; i < n; i++) out.push(bar ? 1 : 0);
      bar = !bar;
    }
  }

  function code128Values(text) {
    if (!text.length) throw new Error("Введите текст для штрихкода");
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) {
        throw new Error("В штрихкоде Code 128 можно использовать только латинские буквы, цифры и знаки. Символ «" + ch + "» не поддерживается.");
      }
    }
    const digitsOnly = /^[0-9]+$/.test(text);
    const vals = [];
    if (digitsOnly && text.length >= 4) {
      let i = 0;
      if (text.length % 2 === 1) {
        // нечётное число цифр: первая цифра набором B, остальное — парами в наборе C
        vals.push(START_B, text.charCodeAt(0) - 32, CODE_C);
        i = 1;
      } else {
        vals.push(START_C);
      }
      for (; i < text.length; i += 2) vals.push(parseInt(text.substr(i, 2), 10));
    } else {
      vals.push(START_B);
      for (const ch of text) vals.push(ch.charCodeAt(0) - 32);
    }
    let sum = vals[0];
    for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
    vals.push(sum % 103, STOP);
    return vals;
  }

  function encodeCode128(text) {
    const vals = code128Values(text);
    const modules = [];
    for (const v of vals) widthsToModules(C128[v], modules);
    return { modules, text, quietLeft: 10, quietRight: 10 };
  }

  // EAN-13
  const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
  const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

  function ean13Check(d12) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += (d12.charCodeAt(i) - 48) * (i % 2 ? 3 : 1);
    return (10 - (s % 10)) % 10;
  }

  function encodeEAN13(text) {
    const t = text.replace(/\s+/g, "");
    if (!/^[0-9]{12,13}$/.test(t)) throw new Error("Для EAN-13 нужно 12 или 13 цифр");
    const check = ean13Check(t.slice(0, 12));
    if (t.length === 13 && +t[12] !== check) {
      throw new Error("Неверная контрольная цифра EAN-13: последняя цифра должна быть " + check);
    }
    const full = t.slice(0, 12) + check;
    let bits = "101";
    const parity = EAN_PARITY[+full[0]];
    for (let i = 1; i <= 6; i++) {
      const d = +full[i];
      bits += parity[i - 1] === "L" ? EAN_L[d] : EAN_G[d];
    }
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += EAN_R[+full[i]];
    bits += "101";
    return { modules: Array.from(bits, (b) => (b === "1" ? 1 : 0)), text: full, quietLeft: 11, quietRight: 7 };
  }

  function encode(format, text) {
    if (format === "ean13") return encodeEAN13(text);
    return encodeCode128(text);
  }

  g.Barcode = { encode, encodeCode128, encodeEAN13, ean13Check };
})(typeof window !== "undefined" ? window : globalThis);
