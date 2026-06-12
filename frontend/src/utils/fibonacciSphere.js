/** Even distribution of n points on a sphere (golden-angle / Fibonacci method). */
export function fibonacciSphere(n, radius) {
  if (n <= 0) return [];
  if (n === 1) return [[0, 0, 0]];

  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    points.push([
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius,
    ]);
  }
  return points;
}
