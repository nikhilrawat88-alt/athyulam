ATHULYAM HOMES GUEST MANAGER — VERSION 1.3
==========================================

Start with: guide/Athulyam-Homes-Setup-Guide.pdf (or the Word version)

What is in this folder
----------------------
app/                     The phone app. Upload everything INSIDE this folder to your GitHub repository
                         (Add file > Upload files > Commit changes). Guide: Step 1, and "Version 1.2".

sheets/Code.gs           Google Sheet script. Paste into Apps Script, replacing Code.gs. Guide: Step 3.
sheets/Logic.gs          Shared calculations. Paste into a second Apps Script file named Logic.

import-old-queries/      For your old queries kept in Numbers.
  athulyam-old-queries-template.xlsx   Open in Numbers or Excel. "How to use" tab explains every column.
  athulyam-old-queries-template.csv    Same headings as a plain CSV.
                         Then in the app: More > Import old queries. Guide: "Version 1.2".

guide/                   Setup guide in Word and PDF (also kept online as your editable doc).

athulyam-test-checklist.xlsx   Tick off each test on your own phone and Google account.

samples/                 Example analytics report (Excel with charts, and PDF) made from test data,
                         so you can see what the export looks like before you have real data.

Upgrading from 1.1 or 1.2?
--------------------------
Upload the app files again (new file: xlsx.js), replace Code.gs and Logic.gs, then
Deploy > Manage deployments > Edit > Version: New version > Deploy.

Coming from version 1.0?
------------------------
Upload the app files, replace Code.gs and Logic.gs, run "setup" once, then
Deploy > Manage deployments > Edit > Version: New version > Deploy.
