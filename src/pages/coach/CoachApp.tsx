import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { COACH_NAV } from "../../components/navs";
import ExportPanel from "../../components/ExportPanel";
import CoachOverview from "./CoachOverview";
import Families from "./Families";
import FamilyDetail from "./FamilyDetail";

function CoachExport() {
  return (
    <Layout nav={COACH_NAV} title="Export data">
      <ExportPanel scope="coach" />
    </Layout>
  );
}

export default function CoachApp() {
  return (
    <Routes>
      <Route index element={<CoachOverview />} />
      <Route path="families" element={<Families />} />
      <Route path="family/:familyId" element={<FamilyDetail />} />
      <Route path="export" element={<CoachExport />} />
      <Route path="*" element={<Navigate to="/coach" replace />} />
    </Routes>
  );
}
