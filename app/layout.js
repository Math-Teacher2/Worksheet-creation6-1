import './globals.css';

export const metadata = {
  title: '맞춤형 학습지 생성기',
  description: '교과서 PDF로 교과서 문제·그림을 담은 컬러 학습지를 학생용·교사용 HWPX로 만듭니다.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
