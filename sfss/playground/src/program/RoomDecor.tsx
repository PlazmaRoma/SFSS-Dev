import type { ReactNode } from "react";

function sprout(x: number, h: number, leaves: 1 | 2 = 2) {
  const leaf = 220 - h + Math.round(h * 0.45);
  return (
    <path
      d={
        `M${x} 220v-${h}` +
        `M${x} ${leaf}c0-8 5-12 11-12 0 8-5 12-11 12` +
        (leaves === 2 ? `M${x} ${leaf}c0-8-5-12-11-12 0 8 5 12 11 12` : "")
      }
    />
  );
}

const SHELL = (
  <>
    <path d="M48 52h538M48 58h538" />
    <path d="M108 52v6M168 52v6M228 52v6M288 52v6M348 52v6M408 52v6M468 52v6M528 52v6" />
    <path d="M276 62h68v10h-68z" />
    <path d="M292 72v7M310 72v7M328 72v7" />
    <path d="M252 232v8M267 232v8M282 232v8M297 232v8M312 232v8M327 232v8M342 232v8M357 232v8M372 232v8" />
  </>
);

const DECOR: Record<string, ReactNode> = {
  crew: (
    <>
      <path d="M104 236v-30h108v30M108 210h100" />
      <path d="M104 196v-30h108v30M108 170h100" />
      <path d="M104 206v-10M212 206v-10" />
      <path d="M112 206v-8h30v8M112 166v-8h30v8" />
      <path d="M216 236v-76M228 236v-76M216 220h12M216 200h12M216 180h12" />
      <path d="M390 236v-68h62v68M421 168v68" />
      <path d="M414 200v10M428 200v10" />
      <path d="M396 176h18v8h-18z" />
      <path d="M396 168v-14h20v14M400 154c2-6 10-6 12 0" />
      <path d="M424 168v-10h22v10" />
    </>
  ),
  lab: (
    <>
      <path d="M104 192h120v6h-120z" />
      <path d="M110 198v38M218 198v38M110 228h108" />
      <path d="M114 198v34h44v-34M114 216h44M132 207h8M132 225h8" />
      <path d="M132 192v-34h34v34M132 170h34M132 181h34" />
      <circle cx="160" cy="164" r="2.4" />
      <circle cx="160" cy="175" r="2.4" />
      <path d="M170 188h32v-26h-32z" />
      <path d="M174 192v-4M198 192v-4M176 170h20M176 176h13" />
      <path d="M204 186h18v6h-18z" />
      <path d="M208 186v-12M213 186v-12M218 186v-12" />
      <path d="M386 236v-60h84v60" />
      <path d="M394 184h68v30h-68z" />
      <circle cx="412" cy="199" r="8" />
      <circle cx="412" cy="199" r="4" />
      <circle cx="444" cy="199" r="8" />
      <circle cx="444" cy="199" r="4" />
      <path d="M396 222h64M414 222v6M444 222v6" />
      <path d="M452 176v-118M448 150h8M448 116h8" />
    </>
  ),
  galley: (
    <>
      <path d="M104 192h104v6h-104z" />
      <path d="M124 198v38M188 198v38M124 226h64" />
      <path d="M132 186h44v6h-44z" />
      <path d="M138 186v-10h12v10M158 186v-10h12v10" />
      <path d="M386 236v-44h72v44" />
      <path d="M392 198h44v32h-44z" />
      <path d="M440 206v14" />
      <circle cx="448" cy="202" r="2.2" />
      <circle cx="448" cy="212" r="2.2" />
      <circle cx="448" cy="222" r="2.2" />
      <path d="M400 192v-16h14v16M426 192v-16h14v16" />
      <path d="M414 180h5v6h-5M440 180h5v6h-5" />
      <path d="M407 176c4-4-4-8 0-12M433 176c4-4-4-8 0-12" />
      <path d="M396 108h52v32h-52z" />
      <path d="M420 108v-50M422 140v6M418 146h8" />
      <circle cx="438" cy="124" r="2.6" />
    </>
  ),
  eva: (
    <>
      <path d="M126 140h88v84h-88z" />
      <circle cx="170" cy="180" r="38" />
      <circle cx="170" cy="180" r="13" />
      <path d="M170 167v-12M170 193v12M157 180h-12M183 180h12" />
      <path d="M194 156l6-6M146 156l-6-6M194 204l6 6M146 204l-6 6" />
      <path d="M150 132h40v-10h-40z" />
      <path d="M118 140v84M114 140h8M114 224h8" />
      <path d="M422 58v26M400 84h44M422 84v6" />
      <circle cx="422" cy="104" r="14" />
      <path d="M412 100c4-6 16-6 20 0" />
      <path d="M414 118h16" />
      <path d="M408 118v46h28v-46" />
      <path d="M414 126h16v14h-16z" />
      <path d="M408 126h-10v30M436 126h10v30M394 156h8M442 156h8" />
      <path d="M410 164v42h8v-42M426 164v42h8v-42" />
      <path d="M410 206h10M426 206h10" />
    </>
  ),
  storage: (
    <>
      <path d="M104 236v-42h58v42M104 206h58M133 206v30M129 200h8" />
      <path d="M108 194v-34h50v34M108 170h50M116 176h18v8h-18z" />
      <path d="M168 236v-56h54v56M168 208h54M195 208v28M191 202h8" />
      <path d="M174 180v-16h42v16M186 164c3-6 15-6 18 0" />
      <path d="M386 236v-76M470 236v-76M386 236h84M386 208h84M386 180h84M386 160h84" />
      <path d="M392 208v-20h24v20M420 208v-14h20v14" />
      <path d="M392 180v-16h30v16M428 180v-12h18v12" />
    </>
  ),
  greenhouse: (
    <>
      <path d="M104 236v-22h96v22M104 220h96" />
      {sprout(124, 18)}
      {sprout(152, 24)}
      {sprout(180, 14, 1)}
      <path d="M108 112h88v10h-88z" />
      <path d="M130 112v-54M174 112v-54" />
      <path d="M120 126v6M144 126v6M168 126v6M190 126v6" />
      <path d="M386 236v-22h84v22M386 220h84" />
      {sprout(406, 20)}
      {sprout(444, 14, 1)}
      <path d="M390 112h76v10h-76z" />
      <path d="M410 112v-54M446 112v-54" />
      <path d="M400 126v6M424 126v6M448 126v6" />
    </>
  ),
};

export function RoomDecor({ id }: { id: string }) {
  const d = DECOR[id];
  return (
    <>
      <g className="decor-far">{SHELL}</g>
      {d && <g className="decor">{d}</g>}
    </>
  );
}
