-- Backfills users.government_id (身份证) for the 31 students enrolled/certified
-- via migration_academy_plp_enroll_students*.sql and
-- migration_academy_plp_issue_certificates.sql, sourced from
-- temp/'PLP Student List.xlsx' 身份证 column. Matched by user_id (already
-- established via phone/name matching in the enrollment migrations).
UPDATE users SET government_id = '513902198701012188' WHERE user_id = 'e983e7c2';
UPDATE users SET government_id = '330625196310072733' WHERE user_id = '217438b4';
UPDATE users SET government_id = '510231197206156623' WHERE user_id = 'f44c794a';
UPDATE users SET government_id = '360724199006074011' WHERE user_id = 'e1a4a5a5';
UPDATE users SET government_id = '422423197703050011' WHERE user_id = 'f6b766d1';
UPDATE users SET government_id = '430703199101220466' WHERE user_id = '6d20b3da';
UPDATE users SET government_id = '422422197106187320' WHERE user_id = 'd389f03b';
UPDATE users SET government_id = '360424198310014987' WHERE user_id = '2b623b60';
UPDATE users SET government_id = '620103196810144047' WHERE user_id = '0b9ef1ba';
UPDATE users SET government_id = '330725197006202310' WHERE user_id = '6656d4e8';
UPDATE users SET government_id = '152125197107220011' WHERE user_id = 'fa52ae8f';
UPDATE users SET government_id = '130531198612162340' WHERE user_id = '15231f7a';
UPDATE users SET government_id = '330225197008143425' WHERE user_id = 'eb821c10';
UPDATE users SET government_id = '330127197503044122' WHERE user_id = '3d96f3d8';
UPDATE users SET government_id = '310108198901152024' WHERE user_id = '641a6b10';
UPDATE users SET government_id = '342201199908098211' WHERE user_id = 'fce8f13a';
UPDATE users SET government_id = '310110196607104622' WHERE user_id = '2e62dc28';
UPDATE users SET government_id = '321028197711210041' WHERE user_id = 'e045248d';
UPDATE users SET government_id = '310104198701142846' WHERE user_id = '3298795e';
UPDATE users SET government_id = '31010319751118004X' WHERE user_id = '5891fcf0';
UPDATE users SET government_id = '420102197902090024' WHERE user_id = '74a9b0c1';
UPDATE users SET government_id = '310229198409150067' WHERE user_id = '619cbc19';
UPDATE users SET government_id = '510702197301021141' WHERE user_id = '01255c93';
UPDATE users SET government_id = '330102196908240613' WHERE user_id = '0d5c3cd9';
UPDATE users SET government_id = '211121197111201040' WHERE user_id = '9e9998ea';
UPDATE users SET government_id = '310104197105252825' WHERE user_id = '45608991';
UPDATE users SET government_id = '22010219761027262X' WHERE user_id = 'dc20b7f0';
UPDATE users SET government_id = '220223198102151524' WHERE user_id = 'ef5e5ff3';
UPDATE users SET government_id = '330722198202094519' WHERE user_id = '2f2cfeec';
UPDATE users SET government_id = '371002198104187011' WHERE user_id = '5258fefc';
UPDATE users SET government_id = '210302197310172124' WHERE user_id = '44b2292b';
