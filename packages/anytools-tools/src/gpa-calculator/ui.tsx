'use client';
import { Button, CalculatorTemplate, Input, NumericPrimary, useLocalized } from '@anytools/ui';
import { useState } from 'react';
import { GRADES, calculateGpa } from './logic';
import type { Course } from './logic';
import { STRINGS } from './strings';

let nextId = 1;
const blank = (): Course => ({ id: nextId++, name: '', grade: 'A', credits: 3 });

export function GpaCalculatorUi() {
  const s = useLocalized(STRINGS);
  const [courses, setCourses] = useState<Course[]>([blank(), blank(), blank()]);

  const { gpa, totalCredits } = calculateGpa(courses);

  const update = (id: number, patch: Partial<Course>) =>
    setCourses((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <div className="space-y-2">
          {courses.map((c) => (
            <div key={c.id} className="grid grid-cols-12 gap-2 items-center">
              <Input
                value={c.name}
                onChange={(e) => update(c.id, { name: e.target.value })}
                placeholder={s.courseNamePlaceholder}
                className="col-span-6 h-11"
                aria-label={s.courseName}
              />
              <select
                value={c.grade}
                onChange={(e) => update(c.id, { grade: e.target.value })}
                className="col-span-3 h-11 rounded-md border bg-background px-2 text-sm"
                aria-label={s.grade}
              >
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                value={c.credits}
                min={0}
                max={12}
                onChange={(e) => update(c.id, { credits: e.target.valueAsNumber || 0 })}
                className="col-span-2 h-11 tabular-nums"
                aria-label={s.credits}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCourses((cs) => cs.filter((x) => x.id !== c.id))}
                aria-label={s.removeCourse}
                className="col-span-1 h-11 w-11"
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setCourses((cs) => [...cs, blank()])}
            className="w-full mt-2"
          >
            {s.addCourse}
          </Button>
        </div>
      }
      result={
        <NumericPrimary
          label={s.cumulativeGpa}
          value={gpa.toFixed(2)}
          unit="/ 4.0"
          caption={s.caption
            .replace('{credits}', String(totalCredits))
            .replace('{n}', String(courses.length))}
        />
      }
      onReset={() => setCourses([blank(), blank(), blank()])}
    />
  );
}
