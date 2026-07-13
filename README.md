# Facebook Comment Author Selector

Extensie Chrome Manifest V3 care detectează comentariile vizibile pe Facebook, permite selectarea autorilor și îi poate bloca după o confirmare explicită. Versiunea curentă este `0.4.0`.

## Funcționalități

- caută comentarii vizibile folosind atribute semantice și mai multe fallback-uri;
- adaugă o bifă lângă autorul fiecărui comentariu;
- permite selecția multiplă și sincronizează duplicatele aceluiași autor;
- afișează lista fără duplicate în panoul din pagină și în popup;
- cere o a doua apăsare pentru confirmarea blocării efective;
- permite minimizarea și maximizarea panoului din butonul `−` / `+`;
- elimină din selecție și debifează autorii procesați cu succes;
- reîncarcă automat fila Facebook după blocări reușite, pentru actualizarea comentariilor;
- detectează și comentariile încărcate prin „Vezi mai multe”, inclusiv containerele reciclate de Facebook;
- procesează profilurile pe rând în file temporare și afișează progresul;
- permite anularea operației între autori;
- nu folosește servicii terțe, analytics sau stocare persistentă.

Selecția este păstrată doar în memoria filei curente și dispare la reîncărcarea paginii. Starea temporară a operației este păstrată în `chrome.storage.session` și dispare când se închide sesiunea Chrome. Datele sunt folosite numai pentru interacțiunea cu paginile Facebook declarate în `manifest.json`; nu sunt trimise către servicii terțe.

## Instalare prin `chrome://extensions`

1. Deschide Chrome și accesează `chrome://extensions`.
2. Activează **Developer mode / Modul pentru dezvoltatori** din colțul dreapta-sus.
3. Apasă **Load unpacked / Încarcă extensia neîmpachetată**.
4. Selectează directorul acestui proiect (`fb-block`).
5. Deschide sau reîncarcă o pagină Facebook care conține comentarii.

## Utilizare

1. Derulează până la comentariile dorite; extensia procesează elementele vizibile încărcate dinamic.
2. Bifează „Selectează” lângă autorii doriți.
3. Verifică lista în panoul din dreapta-jos sau apăsând pictograma extensiei.
4. Apasă **Pregătește blocarea** și verifică avertismentul.
5. Apasă **Confirmă blocarea** pentru a începe operația efectivă. Autorii sunt procesați secvențial în file temporare active, deoarece Facebook poate amâna randarea profilurilor în fundal.
6. Urmărește rezultatul în panou. Dacă Facebook nu expune meniul sau dialogul așteptat, panoul afișează eroarea pentru autorul respectiv și operația continuă.

> **Atenție:** blocarea este o modificare reală a contului Facebook. Interfața Facebook se poate schimba, iar extensia nu încearcă să ocolească verificări, confirmări suplimentare sau restricții ale platformei.

## Structură

- `manifest.json` — declarația Manifest V3 și paginile permise;
- `content.js` — detecție, deduplicare, selecție și panou;
- `content.css` — stilurile izolate prin prefixul `fbcas`;
- `popup.html`, `popup.js` — vizualizarea selecției din fila activă.
- `service-worker.js` — coada secvențială, filele temporare și raportarea rezultatelor.

Facebook își modifică periodic DOM-ul; detecția evită clasele CSS generate, dar etichetele meniului de blocare pot necesita ajustări ulterioare. Sunt recunoscute interfețele Facebook în română și engleză.
