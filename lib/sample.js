// 샘플 학습지 (API 키 없이 화면·HWPX 모양을 확인하는 용도이자, AI에게 보여주는 작성 예시)
// 내용은 예시용으로 새로 쓴 것이며 특정 교과서 문장을 옮긴 것이 아닙니다.

const r = String.raw;

export const SAMPLE_DOC = {
  subject: '미적분Ⅰ',
  unit: 'Ⅰ. 함수의 극한과 연속',
  lessons: [
    {
      no: 1,
      chapterNo: '01',
      chapterTitle: '함수의 극한',
      topic: '함수의 수렴과 발산',
      objective: '함수의 극한의 뜻을 알고, 함수의 수렴과 발산을 판별할 수 있다.',
      sections: [
        {
          title: '함수의 수렴',
          pages: '10~11',
          blocks: [
            {
              type: 'intro',
              items: [r`함수 $f(x)=x^2+1$에서 $x$의 값이 0에 한없이 가까워질 때의 함숫값을 표로 살펴보자.`, r`$x$의 값이 0에 가까워질수록 $f(x)$의 값은 [[1]]에 한없이 가까워진다.`],
              table: { header: [], rows: [[r`$x$`, r`$-0.1$`, r`$-0.01$`, r`$0.01$`, r`$0.1$`], [r`$f(x)$`, '[[1.01]]', '[[1.0001]]', '[[1.0001]]', '[[1.01]]']] },
              tnotes: [{ kind: 'tip', text: r`$x$가 0의 오른쪽과 왼쪽에서 모두 가까워질 수 있음에 유의하게 하고, 그래프와 연결지어 생각하게 한다.` }],
            },
            {
              type: 'lead',
              items: [
                r`함수 $f(x)=x+1$의 그래프에서 $x$의 값이 1이 아니면서 1에 한없이 가까워질 때, $f(x)$의 값은 [[2]]에 한없이 가까워진다.`,
                r`한편, 함수 $g(x)=\dfrac{x^2-1}{x-1}$은 $x=1$에서 정의되지 않지만 $x\neq1$인 모든 실수 $x$에서 $g(x)=$[[$x+1$]]이므로, $x$의 값이 1에 한없이 가까워질 때 $g(x)$의 값은 [[2]]에 한없이 가까워진다.`,
              ],
              figures: ['s1', 's2'],
            },
            {
              type: 'concept',
              tnotes: [
                { kind: 'caution', text: r`함숫값 $f(a)$와 극한값 $\displaystyle\lim_{x\to a}f(x)$를 같은 것으로 여기는 학생이 많다. $x=a$에서 정의되지 않는 함수의 예로 구별하게 한다.` },
                { kind: 'advanced', text: r`엄밀한 정의(ε-δ): 임의의 $\varepsilon>0$에 대하여 $0<|x-a|<\delta$이면 $|f(x)-L|<\varepsilon$인 $\delta>0$가 존재한다.` },
              ],
              title: '함수의 수렴',
              items: [
                r`함수 $f(x)$에서 $x$의 값이 $a$가 아니면서 $a$에 한없이 가까워질 때, $f(x)$의 값이 일정한 값 $L$에 한없이 가까워지면 함수 $f(x)$는 $L$에 [[수렴]]한다고 한다.`,
                r`이것을 기호로 [[$\lim_{x\to a}f(x)=L$]] 또는 $x\to a$일 때 [[$f(x)\to L$]]와 같이 나타낸다.`,
                r`이때 $L$을 함수 $f(x)$의 $x=a$에서의 [[극한값]] 또는 [[극한]]이라고 한다.`,
              ],
              note: r`※ $x\to a$는 $x$의 값이 $a$가 아니면서 $a$에 한없이 가까워짐을 뜻하므로, $x=a$에서의 함숫값과는 관계가 없다.`,
            },
            {
              type: 'check',
              title: '확인하기',
              items: [r`① $\displaystyle\lim_{x\to 1}(x+1)=$[[2]]`, r`② $\displaystyle\lim_{x\to 1}\frac{x^2-1}{x-1}=$[[2]]`, r`③ $\displaystyle\lim_{x\to a}c=$[[$c$]] ($c$는 상수)`],
              cols: 3,
            },
            {
              type: 'example',
              label: '예제 1',
              instruction: '함수의 그래프를 이용하여 다음 극한값을 구하시오.',
              pages: '11',
              cols: 2,
              space: 'm',
              items: [
                { q: r`$\displaystyle\lim_{x\to 1}(x^2+2x)$`, a: '3', sol: r`$x\to1$일 때 $x^2+2x\to1+2=3$` },
                { q: r`$\displaystyle\lim_{x\to 2}\frac{2x^2-3x-2}{x-2}$`, a: '5', sol: r`$\dfrac{(2x+1)(x-2)}{x-2}=2x+1\to5$`, tip: r`분모가 0이 되는 꼴이므로 인수분해 후 약분하는 과정을 짚어 준다.` },
              ],
            },
            {
              type: 'exercise',
              label: '문제 1',
              instruction: '함수의 그래프를 이용하여 다음 극한값을 구하시오.',
              pages: '11',
              cols: 2,
              space: 'm',
              items: [
                { q: r`$\displaystyle\lim_{x\to -1}(x-1)^2$`, a: '4', sol: r`$(-1-1)^2=4$` },
                { q: r`$\displaystyle\lim_{x\to 3}\frac{x^2+2x-15}{x-3}$`, a: '8', sol: r`$\dfrac{(x+5)(x-3)}{x-3}=x+5\to8$` },
              ],
            },
          ],
        },
        {
          title: '함수의 발산',
          pages: '12~13',
          blocks: [
            {
              type: 'concept',
              title: '함수의 발산',
              items: [
                r`• $x\to a$일 때 $f(x)$의 값이 한없이 커지면 $f(x)$는 [[양의 무한대]]로 발산한다고 하고, 기호로 $\displaystyle\lim_{x\to a}f(x)=$[[$\infty$]]와 같이 나타낸다.`,
                r`• $x\to a$일 때 $f(x)$의 값이 음수이면서 그 절댓값이 한없이 커지면 $f(x)$는 [[음의 무한대]]로 발산한다고 하고, 기호로 $\displaystyle\lim_{x\to a}f(x)=$[[$-\infty$]]와 같이 나타낸다.`,
              ],
              note: r`※ 기호 $\infty$는 수가 아니라 한없이 커지는 상태를 나타낸다.`,
            },
            {
              type: 'strategy',
              title: '수렴과 발산의 판별',
              items: [r`① $x\to a$일 때 $f(x)$가 다가가는 값을 그래프나 식으로 확인한다.`, r`② 일정한 값에 다가가면 **수렴**, 한없이 커지거나 작아지면 **발산**이다.`],
              tip: r`분모가 0에 가까워지는 꼴 $\dfrac{1}{x^2}$은 $x\to0$일 때 양의 무한대로 발산한다.`,
            },
            {
              type: 'table',
              title: '극한값을 구하는 방법 정리',
              header: ['꼴', '방법'],
              rows: [
                [r`$\dfrac{0}{0}$ 꼴`, '분자·분모를 인수분해하여 약분하거나, 근호가 있으면 유리화한다.'],
                [r`$\dfrac{\infty}{\infty}$ 꼴`, '분모의 최고차항으로 분자·분모를 나눈다.'],
              ],
            },
            {
              type: 'think',
              title: '생각해보기',
              pages: '13',
              items: [
                {
                  q: r`함수 $f(x)$가 $x=a$에서 정의되지 않으면 $\displaystyle\lim_{x\to a}f(x)$는 존재하지 않는다. 이 명제의 참, 거짓을 판단하고, 거짓이면 반례를 드시오.`,
                  a: '거짓',
                  sol: r`$g(x)=\dfrac{x^2-1}{x-1}$은 $x=1$에서 정의되지 않지만 $\displaystyle\lim_{x\to1}g(x)=2$로 극한값이 존재한다.`,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  figures: [
    { id: 's1', page: 0, box: [0, 0, 1000, 1000], desc: 'y=f(x) 그래프' },
    { id: 's2', page: 0, box: [0, 0, 1000, 1000], desc: 'y=g(x) 그래프' },
  ],
};
