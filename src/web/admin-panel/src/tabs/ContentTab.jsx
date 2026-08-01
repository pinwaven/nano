import React, { useState } from 'react';
import { GraduationCap, ClipboardList, Activity, Calendar } from 'lucide-react';
import { useLang } from '../shared.jsx';
import { AcademyTab } from './AcademyTab.jsx';
import { QuestionnairesTab } from './QuestionnairesTab.jsx';
import { HealthPlansTab } from './HealthPlansTab.jsx';
import { EventsTab } from './EventsTab.jsx';

function ContentTab({ channels, users, coaches, dots, healthPlanTemplates, session, isSuperadmin, onRefresh }) {
  const { t } = useLang();
  const [subTab, setSubTab] = useState('academy');

  return (
    <>
      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'academy' ? ' active' : ''}`} onClick={() => setSubTab('academy')}>
          <GraduationCap size={13} /> {t.nav.academy}
        </button>
        <button className={`subtab-btn${subTab === 'questionnaires' ? ' active' : ''}`} onClick={() => setSubTab('questionnaires')}>
          <ClipboardList size={13} /> {t.nav.questionnaires}
        </button>
        <button className={`subtab-btn${subTab === 'health-plans' ? ' active' : ''}`} onClick={() => setSubTab('health-plans')}>
          <Activity size={13} /> {t.nav.healthPlans}
        </button>
        <button className={`subtab-btn${subTab === 'events' ? ' active' : ''}`} onClick={() => setSubTab('events')}>
          <Calendar size={13} /> {t.nav.events}
        </button>
      </div>

      {subTab === 'academy'        && <AcademyTab />}
      {subTab === 'questionnaires' && <QuestionnairesTab channels={channels} users={users} coaches={coaches} />}
      {subTab === 'health-plans'   && <HealthPlansTab dots={dots} healthPlanTemplates={healthPlanTemplates} onRefresh={onRefresh} />}
      {subTab === 'events'         && <EventsTab channels={channels} session={session} isSuperadmin={isSuperadmin} onRefresh={onRefresh} />}
    </>
  );
}

export { ContentTab };
