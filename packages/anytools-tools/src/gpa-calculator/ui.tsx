'use client';
import { Button, CalculatorTemplate, Input, NumericPrimary } from '@anytools/ui';
import { useState } from 'react';
import { calculateGpa, GRADE_POINTS, GRADES } from './logic';
import type { Course } from './logic';

let nextId = 1;
const blank = (): Course => ({ id: nextId++, name: '', grade: 'A', credits: 3 });

export function GpaCalculatorUi() {
  const [courses, setCourses] = useState<Course[]>([blank(), blank(), blank()]);

  const { gpa, totalCredits } = calculateGpa(courses);

  const update = (id: number, patch: Partial<Course>) =>
    setCourses((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <CalculatorTemplate
      title="GPA Calculator"
      description="US 4.0 scale, weighted by credit hours."
      inputs={
        <div className="space-y-2">
          {courses.map((c) => (
            <div key={c.id} className="grid grid-cols-12 gap-2 items-center">
              <Input
                value={c.name}
                onChange={(e) => update(c.id, { name: e.target.value })}
                placeholder="Course name (optional)"
                className="col-span-6 h-11"
                aria-label="Course name"
              />
              <select
                value={c.grade}
                onChange={(e) => update(c.id, { grade: e.target.value })}
                className="col-span-3 h-11 rounded-md border bg-background px-2 text-sm"
                aria-label="Grade"
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
                aria-label="Credits"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCourses((cs) => cs.filter((x) => x.id !== c.id))}
                aria-label="Remove course"
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
            + Add course
          </Button>
        </div>
      }
      result={
        <NumericPrimary
          label="Cumulative GPA"
          value={gpa.toFixed(2)}
          unit="/ 4.0"
          caption={`${totalCredits} credit hours across ${courses.length} courses`}
        />
      }
      onReset={() => setCourses([blank(), blank(), blank()])}
    />
  );
}
